//! Each native desktop window owns one validated endpoint and one cancellable RFB session.
mod clipboard;
mod frame;
#[cfg(test)]
mod protocol_tests;
mod rfb;
#[cfg(windows)]
mod shared_buffer;
#[cfg(test)]
mod tests;

use crate::{
    model::{Host, Rule, ServiceProtocol, Snapshot},
    service::DirectProtocol,
};
use serde::Deserialize;
use std::{
    collections::HashMap,
    io,
    net::IpAddr,
    sync::{Arc, Mutex},
    time::Duration,
};
use tauri::{ipc::Response, AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tokio::{
    net::TcpStream,
    sync::{mpsc, Mutex as AsyncMutex},
};
use tokio_util::sync::CancellationToken;
use zeroize::Zeroizing;

#[derive(Clone, Debug, PartialEq)]
pub struct Endpoint {
    host: String,
    port: u16,
}
impl Endpoint {
    pub fn parse(value: &str) -> Result<Self, String> {
        let bad = || "Invalid VNC address".to_owned();
        if value.len() > 512 || value.chars().any(|c| c.is_whitespace() || c.is_control()) {
            return Err(bad());
        }
        let (scheme, authority) = value.split_once("://").ok_or_else(bad)?;
        let authority = authority.strip_suffix('/').unwrap_or(authority);
        if !scheme.eq_ignore_ascii_case("vnc")
            || authority.is_empty()
            || authority.contains(['@', '?', '#', '/', '%', '\\'])
        {
            return Err(bad());
        }
        let url = tauri::Url::parse(value).map_err(|_| bad())?;
        let host = url
            .host_str()
            .ok_or_else(bad)?
            .trim_start_matches('[')
            .trim_end_matches(']');
        if host.parse::<IpAddr>().is_err()
            && (host.len() > 253
                || !host.split('.').all(|s| {
                    !s.is_empty()
                        && s.len() <= 63
                        && !s.starts_with('-')
                        && !s.ends_with('-')
                        && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
                }))
        {
            return Err(bad());
        }
        let port = url.port().unwrap_or(5900);
        if port == 0 || authority.ends_with(':') {
            return Err(bad());
        }
        Ok(Self {
            host: host.into(),
            port,
        })
    }
    pub fn address(&self) -> String {
        if self.host.contains(':') {
            format!("[{}]:{}", self.host, self.port)
        } else {
            format!("{}:{}", self.host, self.port)
        }
    }
}

enum Input {
    Password(Zeroizing<String>, bool),
    Wire(Vec<u8>),
    Clipboard { text: String, keys: Vec<u8> },
}
struct Session {
    credential: Option<crate::credentials::VncCredential>,
    id: String,
    cancel: CancellationToken,
    input: mpsc::Sender<Input>,
    output: AsyncMutex<mpsc::Receiver<Result<Vec<u8>, String>>>,
}
impl Drop for Session {
    fn drop(&mut self) {
        self.cancel.cancel();
    }
}
struct Viewer {
    endpoint: Endpoint,
    context: SshContext,
    session: Option<Arc<Session>>,
}

pub(crate) enum SshContext {
    Forward(String),
    Direct(Option<String>),
    External,
}

impl SshContext {
    fn service_user(
        &self,
        endpoint: &Endpoint,
        snapshot: &Snapshot,
        observations: &crate::service_control::Observations,
    ) -> Option<String> {
        let forward = match self {
            Self::Forward(id) => snapshot
                .rules
                .iter()
                .find(|rule| &rule.id == id)
                .and_then(|rule| endpoint.on_forward(snapshot, rule).map(|host| (rule, host))),
            Self::Direct(user) => return user.clone().filter(|user| !user.trim().is_empty()),
            Self::External => match endpoint.display_forwards(snapshot).as_slice() {
                [] => {
                    return endpoint
                        .direct_user(snapshot)
                        .filter(|user| !user.trim().is_empty());
                }
                [matched] => Some(*matched),
                _ => None,
            },
        };
        let (rule, active_host) = forward?;
        let service = Endpoint::forwarded_service(snapshot, rule, active_host)?;
        let host = snapshot.hosts.iter().find(|host| host.id == rule.host_id)?;
        observations
            .running_vnc_user(service, host, &snapshot.hosts)
            .or_else(|| {
                service
                    .execution_login(host, None)
                    .ok()
                    .map(|login| login.user)
            })
            .filter(|user| !user.trim().is_empty())
    }
}

#[derive(Default)]
pub struct Viewers(Mutex<HashMap<String, Viewer>>);
impl Viewers {
    pub fn stop(&self, label: &str) {
        if let Some(s) = self
            .0
            .lock()
            .unwrap()
            .get_mut(label)
            .and_then(|v| v.session.take())
        {
            s.cancel.cancel();
        }
    }
    pub fn remove(&self, label: &str) {
        if let Some(s) = self.0.lock().unwrap().remove(label).and_then(|v| v.session) {
            s.cancel.cancel();
        }
    }
    fn session(&self, label: &str, id: &str) -> Result<Arc<Session>, String> {
        self.0
            .lock()
            .unwrap()
            .get(label)
            .and_then(|v| v.session.as_ref())
            .filter(|s| s.id == id)
            .cloned()
            .ok_or_else(|| "VNC session closed".into())
    }
}

pub fn open(app: &AppHandle, endpoint: Endpoint) -> Result<(), String> {
    let snapshot = crate::app::state(app).snapshot();
    let preferred = endpoint.workspace_host(&snapshot);
    open_with_host(app, endpoint, preferred, SshContext::External)
}
impl Endpoint {
    fn forwarded_service<'a>(
        snapshot: &'a Snapshot,
        rule: &Rule,
        host: &Host,
    ) -> Option<&'a crate::commands::Service> {
        // A forward can reach another machine. Only associate a service on its own SSH host.
        let target = rule.target_host.trim_matches(['[', ']']);
        if rule.kind != crate::model::ForwardKind::L
            || !(target.eq_ignore_ascii_case(host.address.trim_matches(['[', ']']))
                || target.eq_ignore_ascii_case("localhost")
                || target.parse::<IpAddr>().is_ok_and(|ip| ip.is_loopback()))
        {
            return None;
        }
        let candidates = snapshot.services.iter().filter(|service| {
            service.host_ids.contains(&rule.host_id)
                && service.port == Some(rule.target_port)
                && service
                    .direct_protocol
                    .is_none_or(|protocol| protocol == DirectProtocol::Vnc)
        });
        let mut bound = candidates
            .clone()
            .filter(|service| service.rule_ids.contains(&rule.id));
        if let Some(first) = bound.next() {
            return bound.next().is_none().then_some(first);
        }
        let mut candidates = candidates;
        let first = candidates.next()?;
        candidates.next().is_none().then_some(first)
    }

    fn on_forward<'a>(&self, snapshot: &'a Snapshot, rule: &Rule) -> Option<&'a Host> {
        let runtime = snapshot.runtimes.iter().find(|r| r.rule_id == rule.id)?;
        let host = runtime.host_snapshot.as_ref()?;
        let url = crate::service::forwarded_url(rule, host, runtime, DirectProtocol::Vnc).ok()?;
        (&Endpoint::parse(&url).ok()? == self).then_some(host)
    }

    fn forwards<'a>(&self, snapshot: &'a Snapshot) -> Vec<(&'a Rule, &'a Host)> {
        snapshot
            .rules
            .iter()
            .filter(|rule| rule.service_protocol == Some(ServiceProtocol::Vnc))
            .filter_map(|rule| self.on_forward(snapshot, rule).map(|host| (rule, host)))
            .collect()
    }

    fn display_forwards<'a>(&self, snapshot: &'a Snapshot) -> Vec<(&'a Rule, &'a Host)> {
        snapshot
            .rules
            .iter()
            .filter_map(|rule| self.on_forward(snapshot, rule).map(|host| (rule, host)))
            .collect()
    }
    fn address_hosts<'a>(&'a self, snapshot: &'a Snapshot) -> impl Iterator<Item = &'a Host> + 'a {
        let ip = self.host.parse::<IpAddr>().ok();
        snapshot.hosts.iter().filter(move |host| {
            let address = host.address.trim_matches(['[', ']']);
            !host.hidden
                && snapshot.added_host_ids.contains(&host.id)
                && (address.eq_ignore_ascii_case(&self.host)
                    || ip.is_some_and(|ip| address.parse() == Ok(ip)))
        })
    }
    fn direct_user(&self, snapshot: &Snapshot) -> Option<String> {
        let mut hosts = self.address_hosts(snapshot);
        let mut services = self.address_hosts(snapshot).flat_map(|host| {
            snapshot.services.iter().filter_map(move |service| {
                (service.port == Some(self.port)
                    && service
                        .direct_protocol
                        .is_none_or(|protocol| protocol == DirectProtocol::Vnc)
                    && service.host_ids.contains(&host.id))
                .then_some((service, host))
            })
        });
        let login = if let Some((service, host)) = services.next() {
            if services.next().is_some() {
                return None;
            }
            service.execution_login(host, None)
        } else {
            let host = hosts.next()?;
            if hosts.next().is_some() {
                return None;
            }
            host.default_login()
        };
        login.ok().map(|host| host.user)
    }
    fn workspace_host(&self, snapshot: &Snapshot) -> Option<String> {
        let mut matches: std::collections::BTreeSet<_> = self
            .display_forwards(snapshot)
            .iter()
            .map(|(r, _)| r.host_id.clone())
            .collect();
        if matches.is_empty() {
            matches.extend(self.address_hosts(snapshot).map(|host| host.id.clone()));
        }
        if matches.len() == 1 {
            matches.pop_first()
        } else {
            None
        }
    }
    fn credential_binding(&self, snapshot: &Snapshot) -> Vec<u8> {
        let mut routes: Vec<_> = self
            .forwards(snapshot)
            .into_iter()
            .map(|(r, h)| {
                (
                    &r.id,
                    &r.host_id,
                    crate::credentials::binding(h),
                    &r.target_host,
                    r.target_port,
                )
            })
            .collect();
        routes.sort();
        serde_json::to_vec(&(self.address().to_ascii_lowercase(), routes))
            .expect("VNC address and routes serialize")
    }
}
fn open_with_host(
    app: &AppHandle,
    endpoint: Endpoint,
    preferred: Option<String>,
    context: SshContext,
) -> Result<(), String> {
    let label = format!("vnc-{}", uuid::Uuid::new_v4());
    let title = format!("{} · VNC · OriaSSH", endpoint.address());
    let mut config = app
        .config()
        .app
        .windows
        .iter()
        .find(|window| window.label == "main")
        .ok_or("Missing main window configuration")?
        .clone();
    config.label = label.clone();
    config.url = WebviewUrl::App("index.html#vnc".into());
    config.title = title;
    config.visible = true;
    config.width = 1024.;
    config.height = 720.;
    config.min_width = Some(480.);
    config.min_height = Some(320.);
    config.drag_drop_enabled = true;
    let builder = WebviewWindowBuilder::from_config(app, &config).map_err(|e| e.to_string())?;
    let viewers = app.state::<Viewers>();
    viewers.0.lock().unwrap().insert(
        label.clone(),
        Viewer {
            endpoint,
            context,
            session: None,
        },
    );
    app.state::<crate::workspace::Workspaces>()
        .reset(&label, false);
    if let Some(host) = preferred {
        crate::workspace::preferred(app, &label, host);
    }
    if let Err(e) = builder.build() {
        app.state::<crate::workspace::Workspaces>()
            .reset(&label, true);
        viewers.remove(&label);
        return Err(e.to_string());
    }
    Ok(())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum WindowAction {
    Close,
    Minimize,
    ToggleMaximize,
    IsMaximized,
    ToggleFullscreen,
    IsFullscreen,
    StartDragging,
}

#[tauri::command]
pub async fn vnc_window_action(window: WebviewWindow, action: WindowAction) -> tauri::Result<bool> {
    match action {
        WindowAction::Close => window.close()?,
        WindowAction::Minimize => window.minimize()?,
        WindowAction::StartDragging => window.start_dragging()?,
        WindowAction::IsMaximized => return window.is_maximized(),
        WindowAction::IsFullscreen => return window.is_fullscreen(),
        WindowAction::ToggleFullscreen => {
            let fullscreen = !window.is_fullscreen()?;
            window.set_fullscreen(fullscreen)?;
            return Ok(fullscreen);
        }
        WindowAction::ToggleMaximize => {
            if window.is_fullscreen()? {
                window.set_fullscreen(false)?;
            }
            let maximized = window.is_maximized()?;
            if maximized {
                window.unmaximize()?;
            } else {
                window.maximize()?;
            }
            return Ok(!maximized);
        }
    }
    Ok(false)
}

#[tauri::command]
pub fn vnc_window_theme(window: WebviewWindow, theme: Option<tauri::Theme>) -> tauri::Result<()> {
    window.set_theme(theme)
}

#[tauri::command]
pub fn vnc_endpoint(
    window: WebviewWindow,
    viewers: tauri::State<'_, Viewers>,
) -> Result<String, String> {
    viewers
        .0
        .lock()
        .unwrap()
        .get(window.label())
        .map(|v| v.endpoint.address())
        .ok_or_else(|| "Unknown VNC window".into())
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VncAttempt {
    id: String,
    ssh_user: Option<String>,
}

#[tauri::command]
pub fn vnc_begin(
    window: WebviewWindow,
    viewers: tauri::State<'_, Viewers>,
    skip_saved: Option<bool>,
) -> Result<VncAttempt, String> {
    let state = crate::app::state(window.app_handle());
    let snapshot = state.snapshot();
    let mut all = viewers.0.lock().unwrap();
    let view = all.get_mut(window.label()).ok_or("Unknown VNC window")?;
    let credential = crate::credentials::SUPPORTED
        .then(|| state.vnc_credential(&view.endpoint.credential_binding(&snapshot)));
    let ssh_user =
        view.context
            .service_user(&view.endpoint, &snapshot, state.service_observations());
    Ok(VncAttempt {
        id: view.begin(credential, skip_saved.unwrap_or(false)),
        ssh_user,
    })
}

impl Viewer {
    fn begin(
        &mut self,
        credential: Option<crate::credentials::VncCredential>,
        skip_saved: bool,
    ) -> String {
        let endpoint = self.endpoint.clone();
        if let Some(old) = self.session.take() {
            old.cancel.cancel();
        }
        let cancel = CancellationToken::new();
        let (input, mut commands) = mpsc::channel(32);
        let (out, output) = mpsc::channel(1);
        let id = uuid::Uuid::new_v4().to_string();
        self.session = Some(Arc::new(Session {
            credential: credential.clone(),
            id: id.clone(),
            cancel: cancel.clone(),
            input,
            output: AsyncMutex::new(output),
        }));
        tauri::async_runtime::spawn(async move {
            let connect = async {
                let stream = tokio::time::timeout(
                    Duration::from_secs(15),
                    TcpStream::connect((endpoint.host.as_str(), endpoint.port)),
                )
                .await
                .map_err(|_| crate::native_message::plain("vncTimeout"))?
                .map_err(|e| {
                    crate::native_message::message(
                        "vncUnreachable",
                        serde_json::json!({"detail": e.to_string()}),
                    )
                })?;
                stream.set_nodelay(true).map_err(session_error)?;
                rfb::run(stream, &mut commands, &out, credential.as_ref(), skip_saved)
                    .await
                    .map_err(session_error)
            };
            tokio::select! {
                _ = cancel.cancelled() => {}
                _ = async {
                    if let Err(error) = connect.await {
                        let _ = out.send(Err(error)).await;
                    }
                } => {}
            }
        });
        id
    }
}

fn session_error(error: io::Error) -> String {
    let detail = error.to_string();
    if crate::native_message::key(&detail).is_some() {
        return detail;
    }
    match error.kind() {
        io::ErrorKind::TimedOut => crate::native_message::plain("vncTimeout"),
        io::ErrorKind::InvalidData => crate::native_message::plain("vncProtocol"),
        _ => crate::native_message::message(
            "vncDisconnected",
            serde_json::json!({ "detail": detail }),
        ),
    }
}

#[tauri::command]
pub async fn vnc_next(
    window: WebviewWindow,
    viewers: tauri::State<'_, Viewers>,
    id: String,
    shared: Option<bool>,
) -> Result<Response, String> {
    let session = viewers.session(window.label(), &id)?;
    let mut output = session.output.lock().await;
    let packet = tokio::select! {
        _=session.cancel.cancelled()=>return Err("VNC session closed".into()),
        msg=output.recv()=>msg.ok_or("VNC disconnected")??,
    };
    #[cfg(windows)]
    if shared == Some(true) && packet.len() >= 512 * 1024 && matches!(packet[0], 9 | 10) {
        return shared_buffer::deliver(window, session.cancel.clone(), id, packet).await;
    }
    #[cfg(not(windows))]
    let _ = shared;
    Ok(Response::new(packet))
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Action {
    Key {
        keysym: u32,
        down: bool,
    },
    Pointer {
        x: u16,
        y: u16,
        buttons: u8,
        #[serde(default)]
        wheel: u8,
    },
    Password {
        password: String,
        #[serde(default)]
        remember: bool,
    },
    Text {
        text: String,
    },
    Paste {
        text: String,
        #[serde(rename = "controlHeld")]
        control_held: bool,
    },
}
fn key_packet(keysym: u32, down: bool) -> [u8; 8] {
    let [a, b, c, d] = keysym.to_be_bytes();
    [4, u8::from(down), 0, 0, a, b, c, d]
}
#[tauri::command]
pub async fn vnc_input(
    window: WebviewWindow,
    viewers: tauri::State<'_, Viewers>,
    id: String,
    action: Action,
) -> Result<(), String> {
    let session = viewers.session(window.label(), &id)?;
    let input = match action {
        Action::Password { password, remember } => {
            Input::Password(Zeroizing::new(password), remember)
        }
        Action::Text { text } => Input::Clipboard {
            text,
            keys: Vec::new(),
        },
        Action::Paste { text, control_held } => {
            let mut keys = Vec::new();
            if !control_held {
                keys.extend(key_packet(0xffe3, true));
            }
            keys.extend(key_packet(u32::from(b'v'), true));
            keys.extend(key_packet(u32::from(b'v'), false));
            if !control_held {
                keys.extend(key_packet(0xffe3, false));
            }
            Input::Clipboard { text, keys }
        }
        Action::Key { keysym, down } => Input::Wire(key_packet(keysym, down).into()),
        Action::Pointer {
            x,
            y,
            buttons,
            wheel,
        } => {
            let mut data = vec![5, buttons];
            data.extend(x.to_be_bytes());
            data.extend(y.to_be_bytes());
            if matches!(wheel, 8 | 16 | 32 | 64) {
                data.extend_from_within(..);
                data[1] |= wheel;
            }
            Input::Wire(data)
        }
    };
    if matches!(&input, Input::Clipboard { text, .. } if text.len() > clipboard::MAX_TEXT) {
        return Err("Clipboard text exceeds 1 MiB".into());
    }
    session
        .input
        .send(input)
        .await
        .map_err(|_| "VNC session closed".into())
}
#[tauri::command]
pub fn vnc_forget_password(
    window: WebviewWindow,
    viewers: tauri::State<'_, Viewers>,
    id: String,
) -> Result<(), String> {
    if let Some(vault) = &viewers.session(window.label(), &id)?.credential {
        vault.forget()?;
    }
    Ok(())
}
#[tauri::command]
pub fn vnc_end(window: WebviewWindow, viewers: tauri::State<'_, Viewers>, id: String) {
    let mut windows = viewers.0.lock().unwrap();
    if let Some(session) = windows
        .get_mut(window.label())
        .and_then(|viewer| viewer.session.take_if(|session| session.id == id))
    {
        session.cancel.cancel();
    }
}

pub(crate) fn launch(
    app: &AppHandle,
    url: &str,
    host_id: String,
    context: SshContext,
    internal: bool,
) -> Result<(), String> {
    if internal || is_default_vnc(app.clone()) {
        return open_with_host(app, Endpoint::parse(url)?, Some(host_id), context);
    }
    open_default(app, url)
}

fn open_default(app: &AppHandle, url: &str) -> Result<(), String> {
    let failed = |detail: String| {
        crate::native_message::message("openVncFailed", serde_json::json!({ "e": detail }))
    };
    #[cfg(target_os = "macos")]
    {
        // The detached shell launcher only reports whether /usr/bin/open spawned.
        // Wait for Launch Services to accept or reject the URL.
        let _ = app;
        let result = std::process::Command::new("/usr/bin/open")
            .arg(url)
            .output()
            .map_err(|error| failed(error.to_string()))?;
        if result.status.success() {
            Ok(())
        } else {
            Err(failed(
                String::from_utf8_lossy(&result.stderr).trim().into(),
            ))
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        use tauri_plugin_shell::ShellExt;
        #[cfg(windows)]
        windows_protocol_handler(windows::core::w!("vnc"))
            .map_err(|error| failed(error.to_string()))?;
        #[allow(deprecated)]
        app.shell()
            .open(url, None)
            .map_err(|e| failed(e.to_string()))
    }
}

#[cfg(windows)]
fn windows_protocol_handler(scheme: windows::core::PCWSTR) -> windows::core::Result<()> {
    use windows::Win32::{
        Foundation::ERROR_NO_ASSOCIATION,
        UI::Shell::{
            AssocQueryStringW, ASSOCF_IS_PROTOCOL, ASSOCSTR_COMMAND, ASSOCSTR_DDECOMMAND,
            ASSOCSTR_DELEGATEEXECUTE, ASSOCSTR_DROPTARGET,
        },
    };
    // A bare URL Protocol marker resolves to its own ProgID even with no
    // handler. Check the resolved verb, including COM-based packaged handlers.
    for field in [
        ASSOCSTR_COMMAND,
        ASSOCSTR_DELEGATEEXECUTE,
        ASSOCSTR_DROPTARGET,
        ASSOCSTR_DDECOMMAND,
    ] {
        let mut length = 0;
        if unsafe { AssocQueryStringW(ASSOCF_IS_PROTOCOL, field, scheme, None, None, &mut length) }
            .is_ok()
            && length > 1
        {
            return Ok(());
        }
    }
    Err(ERROR_NO_ASSOCIATION.to_hresult().into())
}

#[tauri::command]
pub fn is_default_vnc(app: AppHandle) -> bool {
    #[cfg(target_os = "macos")]
    {
        use objc2_app_kit::NSWorkspace;
        use objc2_foundation::{NSBundle, NSString, NSURL};

        let url = NSURL::URLWithString(&NSString::from_str("vnc://localhost")).unwrap();
        NSWorkspace::sharedWorkspace()
            .URLForApplicationToOpenURL(&url)
            .and_then(|url| NSBundle::bundleWithURL(&url))
            .and_then(|bundle| bundle.bundleIdentifier())
            .is_some_and(|id| id.to_string() == app.config().identifier)
    }
    #[cfg(windows)]
    {
        use windows::{
            core::{w, PWSTR},
            Win32::UI::Shell::{
                AssocQueryStringW, ASSOCF_IS_PROTOCOL, ASSOCF_NOTRUNCATE, ASSOCSTR_PROGID,
            },
        };

        // Match the ProgID registered by vnc-installer.nsh for this product.
        let expected = format!("{}.VNC", app.package_info().name);
        let mut buffer = vec![0; expected.encode_utf16().count() + 1];
        let mut length = buffer.len() as u32;
        let result = unsafe {
            AssocQueryStringW(
                ASSOCF_IS_PROTOCOL | ASSOCF_NOTRUNCATE,
                ASSOCSTR_PROGID,
                w!("vnc"),
                None,
                Some(PWSTR(buffer.as_mut_ptr())),
                &mut length,
            )
        };
        result.is_ok()
            && String::from_utf16_lossy(&buffer[..buffer.len() - 1]).eq_ignore_ascii_case(&expected)
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        let _ = app;
        false
    }
}

#[tauri::command]
pub async fn choose_default_vnc(app: AppHandle) -> Result<(), String> {
    #[cfg(windows)]
    {
        use tauri_plugin_shell::ShellExt;
        #[allow(deprecated)]
        app.shell()
            .open("ms-settings:defaultapps?registeredAppUser=OriaSSH", None)
            .map_err(|e| e.to_string())
    }
    #[cfg(target_os = "macos")]
    {
        choose_macos_handler(&app).await
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        let _ = app;
        Err("Unsupported platform".into())
    }
}

#[cfg(target_os = "macos")]
async fn choose_macos_handler(app: &AppHandle) -> Result<(), String> {
    use objc2_foundation::{NSBundle, NSError, NSString};

    let bundle = NSBundle::mainBundle();
    if bundle.bundleIdentifier().as_deref() != Some(&*NSString::from_str(&app.config().identifier))
    {
        return Err(crate::native_message::plain("vncAppBundleRequired"));
    }

    if objc2::available!(macos = 12.0) {
        let (send, receive) = tokio::sync::oneshot::channel();
        {
            let send = Mutex::new(Some(send));
            let completed = block2::RcBlock::new(move |error: *mut NSError| {
                // AppKit owns the optional NSError for the duration of the callback.
                let result = unsafe { error.as_ref() }
                    .map(|error| Err(error.localizedDescription().to_string()))
                    .unwrap_or(Ok(()));
                if let Some(sender) = send.lock().unwrap().take() {
                    let _ = sender.send(result);
                }
            });
            objc2_app_kit::NSWorkspace::sharedWorkspace()
                .setDefaultApplicationAtURL_toOpenURLsWithScheme_completionHandler(
                    &bundle.bundleURL(),
                    &NSString::from_str("vnc"),
                    Some(&completed),
                );
        }
        return receive.await.map_err(|e| e.to_string())?;
    }

    // macOS 11 predates the URL-based NSWorkspace setter.
    #[link(name = "CoreServices", kind = "framework")]
    extern "C" {
        fn LSSetDefaultHandlerForURLScheme(
            scheme: *const std::ffi::c_void,
            bundle: *const std::ffi::c_void,
        ) -> i32;
    }
    let result = unsafe {
        LSSetDefaultHandlerForURLScheme(
            std::ptr::from_ref(&*NSString::from_str("vnc")).cast(),
            std::ptr::from_ref(&*NSString::from_str(&app.config().identifier)).cast(),
        )
    };
    if result == 0 {
        Ok(())
    } else {
        Err(format!("Launch Services error {result}"))
    }
}
