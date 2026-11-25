#[path = "app_commands.rs"]
pub mod command_api;
#[path = "app_files.rs"]
pub mod file_api;
#[path = "app_service.rs"]
pub mod service_api;
#[path = "app_sessions.rs"]
mod sessions;
#[path = "app_terminal.rs"]
pub mod terminal_api;
use crate::{model::*, ssh_config, tunnel};
use std::{
    collections::{BTreeMap, BTreeSet},
    path::PathBuf,
    sync::{Arc, Mutex},
};
use tauri::{Emitter, Manager};
use tokio::{sync::oneshot, task::JoinHandle};
use tokio_util::sync::CancellationToken;

struct Worker {
    rule: Rule,
    cancel: CancellationToken,
    join: JoinHandle<()>,
}
struct PendingTrust {
    run_id: String,
    fingerprint: String,
    endpoint: String,
    reply: oneshot::Sender<bool>,
}
struct PendingImport {
    token: String,
    base: Vec<u8>,
    package: crate::config_import::Package,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HostPasswordEdit {
    login_id: String,
    password: Option<String>,
    clear_password: bool,
}

struct DeletedHost {
    id: String,
    manual: Option<Host>,
    metadata: Option<HostMetadata>,
    snapshot: Option<Host>,
    hidden: bool,
    services: Vec<DeletedHostService>,
}

enum DeletedHostService {
    Removed(Box<crate::commands::Service>),
    Detached {
        id: String,
        had_host: bool,
        rule_ids: Vec<String>,
        login_id: Option<String>,
    },
}

#[derive(serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HostDeletionService {
    id: String,
    name: String,
    revision: String,
    remove: bool,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostDeletionImpact {
    rules: Vec<Rule>,
    services: Vec<HostDeletionService>,
    active: bool,
}

impl HostDeletionImpact {
    fn check(&self, rules: &[String], services: &[HostDeletionService]) -> Result<(), String> {
        if self
            .rules
            .iter()
            .map(|rule| &rule.id)
            .collect::<BTreeSet<_>>()
            != rules.iter().collect()
        {
            return Err(crate::native_message::plain("hostRulesChanged"));
        }
        if self.services != services {
            return Err(crate::native_message::plain("hostServicesChanged"));
        }
        Ok(())
    }
}
#[derive(Clone, Copy, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DeletionKind {
    Host,
    Forward,
}

struct DeletedForwards {
    rules: Vec<Rule>,
    removed_hosts: BTreeSet<String>,
}

#[derive(Default)]
struct DeletionHistory {
    hosts: Vec<(DeletedHost, Vec<Rule>)>,
    forwards: Vec<DeletedForwards>,
}

fn validate_login_references(config: &Config, host: &Host) -> Result<(), String> {
    for id in config
        .services
        .iter()
        .filter_map(|s| s.login_by_host.get(&host.id))
    {
        host.login(Some(id))?;
    }
    Ok(())
}

fn clear_projected_credentials(host: &mut Host, previous_ids: &[String]) {
    host.logins.retain(|login| {
        !host.credential_ids.contains(&login.id) && !previous_ids.contains(&login.id)
    });
    if host.credential_only {
        host.user.clear();
        host.identity_files.clear();
        host.auth_method = AuthMethod::Auto;
        host.primary_login_label.clear();
    }
    host.active_login_id = None;
}

fn host_checkpoint(mut host: Host) -> Host {
    clear_projected_credentials(&mut host, &[]);
    host
}

fn project_credentials(config: &Config, host: &mut Host) -> Result<(), String> {
    clear_projected_credentials(host, &[]);
    for id in &host.credential_ids {
        host.logins.push(
            config
                .login_credentials
                .get(id)
                .cloned()
                .ok_or_else(|| crate::native_message::plain("loginIdentityMissing"))?,
        );
    }
    if host.credential_only
        && !host
            .default_login_id
            .as_ref()
            .is_some_and(|id| host.credential_ids.contains(id))
    {
        return Err(crate::native_message::plain("loginIdentityMissing"));
    }
    if host.credential_only {
        *host = host.login(host.default_login_id.as_deref())?;
    } else if let Some(id) = &host.default_login_id {
        host.login(Some(id))?;
    }
    Ok(())
}

fn current_host_credentials(config: &Config, host: &Host) -> Result<Host, String> {
    let mut current = config
        .hosts
        .iter()
        .find(|saved| saved.id == host.id)
        .unwrap_or(host)
        .clone();
    if let Some(metadata) = config.host_metadata.get(&host.id) {
        current.logins.clone_from(&metadata.logins);
        current.credential_ids.clone_from(&metadata.credential_ids);
        current
            .default_login_id
            .clone_from(&metadata.default_login_id);
    }
    project_credentials(config, &mut current)?;
    Ok(current)
}

fn remember_deletion<T>(history: &mut Vec<T>, entry: T) {
    history.push(entry);
    if history.len() > 20 {
        history.remove(0);
    }
}
#[derive(Default)]
struct LoginCredentials {
    secret: tunnel::Secret,
    jumps: BTreeMap<String, tunnel::Secret>,
    remember: std::collections::BTreeSet<String>,
}
pub struct AppState {
    files: Arc<crate::files::Manager>,
    commands: Arc<crate::commands::Manager>,
    observations: Arc<crate::service_control::Observations>,
    terminals: Arc<crate::terminal::Manager>,
    terminal_workers: tokio::sync::Mutex<BTreeMap<String, JoinHandle<()>>>,
    command_workers: tokio::sync::Mutex<BTreeMap<String, JoinHandle<()>>>,
    vault: crate::credentials::Vault,
    credential_errors: Mutex<BTreeMap<(String, String), String>>,
    config: Mutex<Config>,
    discovery: Mutex<ssh_config::Discovery>,
    source_scan: Mutex<()>,
    runtimes: Mutex<BTreeMap<String, Runtime>>,
    runtime_rules: Mutex<BTreeMap<String, Rule>>,
    workers: tokio::sync::Mutex<BTreeMap<String, Worker>>,
    trust: Mutex<BTreeMap<String, PendingTrust>>,
    revision: std::sync::atomic::AtomicU64,
    path: PathBuf,
    shutting_down: std::sync::atomic::AtomicBool,
    update_installing: std::sync::atomic::AtomicBool,
    generations: Mutex<BTreeMap<String, String>>,
    wake: tokio::sync::watch::Sender<u64>,
    activity: Mutex<crate::activity::Activity>,
    deleted: Mutex<DeletionHistory>,
    import: Mutex<Option<PendingImport>>,
    autostart: Mutex<Result<bool, String>>,
    power_missing: std::sync::atomic::AtomicBool,
}
// Publish a complete backup before the ordinary atomic configuration replacement.
fn save_migration_backup(backup: PathBuf, original: &[u8]) -> Result<(), String> {
    use std::io::Write;
    if backup.is_file() {
        return Ok(());
    }
    let parent = backup
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or(std::path::Path::new("."));
    let mut tmp = tempfile::NamedTempFile::new_in(parent).map_err(|_| "backupFailed")?;
    tmp.write_all(original)
        .and_then(|_| tmp.as_file().sync_all())
        .map_err(|_| "backupFailed")?;
    match tmp.persist_noclobber(&backup) {
        Ok(_) => Ok(()),
        Err(e) if e.error.kind() == std::io::ErrorKind::AlreadyExists && backup.is_file() => Ok(()),
        Err(_) => Err("backupFailed".into()),
    }
}

impl AppState {
    pub(crate) fn vnc_credential(&self, binding: &[u8]) -> crate::credentials::VncCredential {
        self.vault.vnc(binding)
    }
    pub(crate) fn service_observations(&self) -> &crate::service_control::Observations {
        &self.observations
    }
    #[cfg(test)]
    pub(crate) fn isolated(path: PathBuf) -> Self {
        Self::load_with_discovery(path, Default::default()).unwrap()
    }
    pub fn load(path: PathBuf) -> Result<Self, String> {
        let state = Self::load_with_discovery(path, Default::default())?;
        let sources = state.config.lock().unwrap().source_files.clone();
        state.reconcile_hosts(ssh_config::discover_with(&sources))?;
        Ok(state)
    }
    fn load_with_discovery(
        path: PathBuf,
        discovery: ssh_config::Discovery,
    ) -> Result<Self, String> {
        let mut config: Config = if path.exists() {
            serde_json::from_slice(&std::fs::read(&path).map_err(|e| e.to_string())?).map_err(
                |e| {
                    crate::native_message::message(
                        "configRead",
                        serde_json::json!({"e": (e).to_string()}),
                    )
                },
            )?
        } else {
            Config::default()
        };
        for rule in &mut config.rules {
            rule.bind_primary_if_missing();
        }
        // Existing forward references already authorize these service/host pairs.
        for service in &mut config.services {
            if service.host_ids.is_empty() {
                service.host_ids = config
                    .rules
                    .iter()
                    .filter(|r| service.rule_ids.contains(&r.id))
                    .map(|r| r.host_id.clone())
                    .collect::<BTreeSet<_>>()
                    .into_iter()
                    .collect();
            }
            if service.port.is_none() {
                let ports: BTreeSet<_> = config
                    .rules
                    .iter()
                    .filter(|r| service.rule_ids.contains(&r.id) && r.kind != ForwardKind::D)
                    .map(|r| {
                        if r.kind == ForwardKind::L {
                            r.target_port
                        } else {
                            r.bind_port
                        }
                    })
                    .collect();
                if ports.len() == 1 {
                    service.port = ports.into_iter().next();
                }
            }
        }
        let state = Self {
            files: Arc::new(crate::files::Manager::new(
                path.with_file_name("transfers.json"),
            )),
            commands: Arc::new(Default::default()),
            observations: Arc::new(Default::default()),
            terminals: Arc::new(Default::default()),
            terminal_workers: Default::default(),
            command_workers: Default::default(),
            vault: crate::credentials::Vault::new(&path),
            credential_errors: Mutex::new(BTreeMap::new()),
            config: Mutex::new(config),
            discovery: Mutex::new(discovery),
            source_scan: Mutex::default(),
            runtimes: Mutex::new(BTreeMap::new()),
            runtime_rules: Mutex::new(BTreeMap::new()),
            workers: tokio::sync::Mutex::new(BTreeMap::new()),
            trust: Mutex::new(BTreeMap::new()),
            revision: 0.into(),
            activity: Mutex::new(crate::activity::Activity::open(path.with_file_name("logs"))),
            wake: tokio::sync::watch::channel(0).0,
            deleted: Mutex::default(),
            import: Mutex::new(None),
            autostart: Mutex::new(crate::long_running::read()),
            power_missing: false.into(),
            path,
            shutting_down: false.into(),
            update_installing: false.into(),
            generations: Mutex::new(BTreeMap::new()),
        };
        Ok(state)
    }
    fn persist(&self, config: &Config) -> Result<(), String> {
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?
        }
        if self.path.exists() {
            let original = std::fs::read(&self.path).map_err(|_| "backupFailed")?;
            let value: serde_json::Value =
                serde_json::from_slice(&original).map_err(|_| "backupFailed")?;
            if value["rules"]
                .as_array()
                .is_some_and(|rules| rules.iter().any(|rule| rule["loginIdentityId"].is_null()))
            {
                save_migration_backup(self.path.with_extension("pre-c006.json"), &original)?;
            }
            let services = value["services"].as_array();
            if services.is_some_and(|items| {
                items
                    .iter()
                    .any(|s| s.get("hostIds").is_none() || s.get("port").is_none())
            }) {
                save_migration_backup(
                    self.path.with_extension("pre-host-services.json"),
                    &original,
                )?;
            }
            if !config.services.is_empty() {
                save_migration_backup(self.path.with_extension("pre-commands.json"), &original)?;
                if services.is_some_and(|items| items.iter().any(|s| s.get("control").is_none())) {
                    save_migration_backup(
                        self.path.with_extension("pre-service-checks.json"),
                        &original,
                    )?;
                }
                if services
                    .is_some_and(|items| items.iter().any(|s| s.get("executionEnabled").is_none()))
                {
                    save_migration_backup(
                        self.path.with_extension("pre-service-sharing.json"),
                        &original,
                    )?;
                }
            }
        }
        let tmp = self.path.with_extension("tmp");
        std::fs::write(&tmp, serde_json::to_vec_pretty(config).unwrap())
            .map_err(|e| e.to_string())?;
        std::fs::rename(tmp, &self.path).map_err(|e| e.to_string())
    }
    fn stage_import(
        &self,
        bytes: &[u8],
        file_name: String,
    ) -> Result<crate::config_import::Preview, String> {
        let package = crate::config_import::parse(bytes)?;
        let base = serde_json::to_vec(&*self.config.lock().unwrap())
            .map_err(|_| crate::native_message::plain("configPreview"))?;
        let snapshot = self.snapshot();
        if base
            != serde_json::to_vec(&*self.config.lock().unwrap())
                .map_err(|_| crate::native_message::plain("configPreview"))?
        {
            return Err(crate::native_message::plain("configChanged"));
        }
        let token = uuid::Uuid::new_v4().to_string();
        let preview = package.preview(&snapshot, token.clone(), file_name);
        *self.import.lock().unwrap() = Some(PendingImport {
            token,
            base,
            package,
        });
        Ok(preview)
    }
    fn apply_import(
        &self,
        token: &str,
        choices: &crate::config_import::Choices,
    ) -> Result<(), String> {
        let snapshot = self.snapshot();
        let mut pending = self.import.lock().unwrap();
        let import = pending
            .as_ref()
            .filter(|p| p.token == token)
            .ok_or(crate::native_message::plain("importExpired"))?;
        let plan = import.package.prepare(&snapshot, choices)?;
        let mut current = self.config.lock().unwrap();
        if import.base
            != serde_json::to_vec(&*current)
                .map_err(|_| crate::native_message::plain("configCompare"))?
        {
            return Err(crate::native_message::plain("importChanged"));
        }
        let mut next = current.clone();
        for (id, credential) in plan.login_credentials {
            if next.login_credentials.insert(id, credential).is_some() {
                return Err(crate::native_message::plain("importSelectionInvalid"));
            }
        }
        next.hosts
            .extend(plan.hosts.into_iter().map(host_checkpoint));
        next.rules.extend(plan.rules);
        next.services.extend(plan.services);
        self.persist(&next)?;
        *current = next;
        *pending = None;
        Ok(())
    }
    fn add_discovered_hosts(&self, ids: &[String]) -> Result<(), String> {
        if ids.is_empty() {
            return Err(crate::native_message::plain("selectHosts"));
        }
        let hosts = self.snapshot().hosts;
        // Validate the entire selection before writing a single transaction.
        let selected = ids
            .iter()
            .collect::<BTreeSet<_>>()
            .into_iter()
            .map(|id| {
                hosts
                    .iter()
                    .find(|h| &h.id == id && h.source == "config")
                    .cloned()
                    .ok_or(crate::native_message::plain("hostsDisappeared"))
            })
            .collect::<Result<Vec<_>, _>>()?;
        let mut config = self.config.lock().unwrap();
        let mut next = config.clone();
        for host in selected {
            next.host_metadata
                .entry(host.id.clone())
                .or_insert_with(|| HostMetadata {
                    logins: host.logins.clone(),
                    credential_ids: host.credential_ids.clone(),
                    default_login_id: host.default_login_id.clone(),
                    name: host.name.clone(),
                    appearance: host.appearance.clone(),
                    tags: host.tags.clone(),
                });
            next.host_snapshots.insert(host.id.clone(), host);
        }
        self.persist(&next)?;
        *config = next;
        Ok(())
    }
    fn upsert_host(
        &self,
        mut host: Host,
        password_edit: Option<HostPasswordEdit>,
    ) -> Result<(), String> {
        if let Some(appearance) = &host.appearance {
            appearance.validate()?;
        }
        host.connection.validate()?;
        crate::ssh_algorithms::preferred(&host.algorithms)?;
        host.identity_files.retain(|path| !path.trim().is_empty());
        host.tags = host
            .tags
            .into_iter()
            .map(|tag| tag.trim().to_string())
            .filter(|tag| !tag.is_empty())
            .collect();
        if host.name.trim().is_empty()
            || host.address.trim().is_empty()
            || (!host.credential_only && !valid_ssh_user(&host.user))
            || host.port == 0
        {
            return Err(crate::native_message::plain("hostFields"));
        }
        if host.primary_login_label.len() > 256
            || host.primary_login_label.chars().any(char::is_control)
        {
            return Err(crate::native_message::plain("loginIdentityMissing"));
        }
        if host.id.starts_with("ssh:") || host.id.starts_with("ssh-jump:") {
            return Err(crate::native_message::plain("editSourceHost"));
        }
        if host.id.is_empty() {
            host.id = uuid::Uuid::new_v4().to_string()
        }
        host.source = "manual".into();
        host.source_file = None;
        host.diagnostics.clear();
        let mut hosts = self.snapshot().hosts;
        hosts.retain(|h| h.id != host.id);
        hosts.push(host.clone());
        resolve_jumps(&hosts, &host)?;
        let mut config = self.config.lock().unwrap();
        let mut next = config.clone();
        let previous_ids = next
            .hosts
            .iter()
            .find(|h| h.id == host.id)
            .map_or(&[][..], |h| h.credential_ids.as_slice());
        clear_projected_credentials(&mut host, previous_ids);
        let mut effective = host.clone();
        project_credentials(&next, &mut effective)?;
        self.validate_host_credentials(&next, &effective)?;
        next.hosts.retain(|h| h.id != host.id);
        next.hosts.push(host);
        self.persist_host_edit(&next, &effective, password_edit)?;
        *config = next;
        Ok(())
    }
    fn persist_host_edit(
        &self,
        next: &Config,
        host: &Host,
        password_edit: Option<HostPasswordEdit>,
    ) -> Result<(), String> {
        let Some(edit) = password_edit else {
            return self.persist(next);
        };
        let password = edit.password.map(tunnel::Secret::from);
        let password = password.as_deref().filter(|password| !password.is_empty());
        if password.is_some_and(|password| password.len() > 65536)
            || (password.is_some() && edit.clear_password)
        {
            return Err(crate::native_message::plain("passwordPrepareFailed"));
        }
        if password.is_none() && !edit.clear_password {
            return self.persist(next);
        }
        let login = host.login(Some(&edit.login_id))?;
        if login.login_id() != edit.login_id
            || host.credential_ids.contains(&edit.login_id)
            || (host.source == "config" && login.active_login_id.is_none())
        {
            return Err(crate::native_message::plain("loginIdentityMissing"));
        }
        self.vault
            .primary(&login)
            .replace_with(password, || self.persist(next))?;
        self.credential_errors
            .lock()
            .unwrap()
            .remove(&(host.id.clone(), edit.login_id));
        Ok(())
    }
    fn validate_host_credentials(&self, config: &Config, host: &Host) -> Result<(), String> {
        validate_logins(&host.logins)?;
        validate_login_references(config, host)
    }
    fn save_login_credential(
        &self,
        credential: LoginIdentity,
        password: Option<tunnel::Secret>,
        clear_password: bool,
    ) -> Result<(), String> {
        validate_logins(std::slice::from_ref(&credential))?;
        let password = password.as_deref().filter(|password| !password.is_empty());
        if password.is_some_and(|password| password.len() > 65536)
            || (password.is_some() && clear_password)
        {
            return Err(crate::native_message::plain("passwordPrepareFailed"));
        }
        let mut config = self.config.lock().unwrap();
        let mut next = config.clone();
        let previous = next.login_credentials.get(&credential.id);
        let changed_account = previous.is_some_and(|login| {
            login.user != credential.user || login.auth_method != credential.auth_method
        });
        let entry = self.vault.credential(&credential);
        next.login_credentials
            .insert(credential.id.clone(), credential);
        if password.is_some()
            || (crate::credentials::SUPPORTED && (clear_password || changed_account))
        {
            entry.replace_with(password, || self.persist(&next))?;
        } else {
            self.persist(&next)?;
        }
        *config = next;
        Ok(())
    }
    fn delete_login_credential(&self, id: &str) -> Result<(), String> {
        let mut config = self.config.lock().unwrap();
        let is_linked = |ids: &[String]| ids.iter().any(|value| value == id);
        if config
            .hosts
            .iter()
            .any(|host| is_linked(&host.credential_ids))
            || config
                .host_metadata
                .values()
                .any(|host| is_linked(&host.credential_ids))
            || self.deleted.lock().unwrap().hosts.iter().any(|(host, _)| {
                host.manual
                    .as_ref()
                    .is_some_and(|host| is_linked(&host.credential_ids))
                    || host
                        .metadata
                        .as_ref()
                        .is_some_and(|host| is_linked(&host.credential_ids))
            })
        {
            return Err(crate::native_message::plain("loginCredentialInUse"));
        }
        let mut next = config.clone();
        let removed = next
            .login_credentials
            .remove(id)
            .ok_or_else(|| crate::native_message::plain("loginIdentityMissing"))?;
        if crate::credentials::SUPPORTED {
            self.vault
                .credential(&removed)
                .replace_with(None, || self.persist(&next))?;
        } else {
            self.persist(&next)?;
        }
        *config = next;
        Ok(())
    }
    pub fn snapshot(&self) -> Snapshot {
        let config = self.config.lock().unwrap();
        let discovery = self.discovery.lock().unwrap();
        let mut hosts = discovery.hosts.clone();
        hosts.extend(config.hosts.clone());
        for (id, saved) in &config.host_snapshots {
            if (config.rules.iter().any(|r| &r.host_id == id)
                || config.host_metadata.contains_key(id))
                && !hosts.iter().any(|h| &h.id == id)
            {
                let mut h = saved.clone();
                h.diagnostics
                    .push(crate::native_message::plain("hostSourceLost"));
                hosts.push(h);
            }
        }
        for host in &mut hosts {
            host.hidden = config.hidden_hosts.contains(&host.id);
            if let Some(metadata) = config.host_metadata.get(&host.id) {
                host.logins.clone_from(&metadata.logins);
                host.credential_ids.clone_from(&metadata.credential_ids);
                host.default_login_id.clone_from(&metadata.default_login_id);
                host.name = metadata.name.clone();
                host.appearance = metadata.appearance.clone();
                host.tags = metadata.tags.clone();
            }
            if let Err(error) = project_credentials(&config, host) {
                host.diagnostics.push(error);
            }
        }
        // Resolve against one unmodified set of diagnostics, then apply the errors.
        let jump_errors: Vec<_> = hosts
            .iter()
            .enumerate()
            .filter(|(_, host)| host.proxy_jump.is_some())
            .filter_map(|(index, host)| resolve_jumps(&hosts, host).err().map(|e| (index, e)))
            .collect();
        for (index, error) in jump_errors {
            if !hosts[index].diagnostics.contains(&error) {
                hosts[index].diagnostics.push(error);
            }
        }
        let hosts_by_id: BTreeMap<_, _> = hosts.iter().rev().map(|h| (h.id.as_str(), h)).collect();
        let mut rules = config.rules.clone();
        for rule in &mut rules {
            if let Some(host) = hosts_by_id.get(rule.host_id.as_str()) {
                rule.resolve_host_login(host);
            }
        }
        let rules_by_id: BTreeMap<_, _> = rules.iter().rev().map(|r| (r.id.as_str(), r)).collect();
        let mut runtimes: Vec<_> = self.runtimes.lock().unwrap().values().cloned().collect();
        {
            let running_rules = self.runtime_rules.lock().unwrap();
            for runtime in runtimes.iter_mut().filter(|r| !r.configuration_changed) {
                runtime.configuration_changed =
                    running_rules.get(&runtime.rule_id).is_some_and(|before| {
                        rules_by_id
                            .get(before.id.as_str())
                            .is_none_or(|after| !after.same_connection(before))
                    }) || runtime
                        .host_snapshot
                        .iter()
                        .chain(runtime.jump_snapshots.iter())
                        .any(|before| {
                            hosts_by_id
                                .get(before.id.as_str())
                                .is_none_or(|after| !after.matches_login(before))
                        });
            }
        }
        let startup = self.autostart.lock().unwrap().clone();
        let mut added_host_ids: std::collections::BTreeSet<String> = config
            .hosts
            .iter()
            .map(|host| host.id.clone())
            .chain(config.host_metadata.keys().cloned())
            .chain(config.rules.iter().map(|rule| rule.host_id.clone()))
            .collect();
        let mut pending: Vec<_> = added_host_ids.iter().cloned().collect();
        while let Some(id) = pending.pop() {
            if let Some(route) = hosts_by_id
                .get(id.as_str())
                .and_then(|host| host.proxy_jump.as_deref())
            {
                for jump in route.split(',').map(str::trim) {
                    if hosts_by_id.contains_key(jump) && added_host_ids.insert(jump.into()) {
                        pending.push(jump.into());
                    }
                }
            }
        }
        let deleted = self.deleted.lock().unwrap();
        let mut services = config.services.clone();
        for service in &mut services {
            for action in &mut service.actions {
                if service.control.start_action_id.as_ref() != Some(&action.id) {
                    action.use_foreground_timeout();
                }
            }
        }
        Snapshot {
            services,
            login_credentials: config.login_credentials.values().cloned().collect(),
            password_storage_supported: crate::credentials::SUPPORTED,
            hosts,
            added_host_ids: added_host_ids.into_iter().collect(),
            rules,
            runtimes,
            diagnostics: {
                let mut diagnostics = discovery.diagnostics.clone();
                if self.activity.lock().unwrap().write_failed {
                    diagnostics.push(crate::native_message::plain("activityWrite"));
                }
                if self
                    .power_missing
                    .load(std::sync::atomic::Ordering::Relaxed)
                {
                    diagnostics.push(crate::native_message::plain("wakeUnavailable"));
                }
                diagnostics
            },
            revision: self.revision.load(std::sync::atomic::Ordering::SeqCst),
            close_to_tray: config.close_to_tray,
            agent_supported: cfg!(any(windows, target_os = "macos")),
            source_files: config.source_files.clone(),
            auto_sync_hosts: config.auto_sync_hosts,
            activity: self.activity.lock().unwrap().records(),
            host_undo_count: deleted.hosts.len(),
            forward_undo_count: deleted.forwards.len(),
            autostart: startup.as_ref().copied().unwrap_or(false),
            autostart_supported: crate::long_running::AUTOSTART_SUPPORTED,
            autostart_error: startup.err(),
        }
    }
    pub fn publish(&self, app: &tauri::AppHandle) {
        self.revision
            .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        let snapshot = self.snapshot();
        crate::desktop::update_tray(app, &snapshot);
        crate::workspace::publish_hosts(app, &snapshot);
        let _ = app.emit("tunnel://snapshot", snapshot);
    }
    pub(crate) fn tray_service_activity(&self) -> crate::desktop::TrayServiceActivity {
        let mut activity = crate::desktop::TrayServiceActivity::default();
        for run in self.commands.list().into_iter().filter(|run| run.active()) {
            activity.busy.insert(run.service_id);
        }
        for session in self
            .terminals
            .list()
            .into_iter()
            .filter(|session| session.active())
        {
            if let Some(service) = session.service_id {
                activity.busy.insert(service.clone());
                if let (Some(rule), Some(action)) = (session.rule_id, session.action_id) {
                    activity.terminals.insert((service, rule, action));
                }
            }
        }
        activity
    }
    pub fn has_file_work(&self) -> bool {
        !self.files.active_ids().is_empty()
    }
    pub async fn shutdown(&self) {
        self.shutting_down
            .store(true, std::sync::atomic::Ordering::SeqCst);
        self.stop_all().await;
        self.files.shutdown().await;
    }
    pub fn update_installing(&self) -> bool {
        self.update_installing
            .load(std::sync::atomic::Ordering::SeqCst)
    }
    pub fn finish_update_attempt(&self) {
        self.files
            .closing
            .store(false, std::sync::atomic::Ordering::SeqCst);
        self.update_installing
            .store(false, std::sync::atomic::Ordering::SeqCst);
    }
    pub async fn active_work_ids(&self) -> Vec<String> {
        let mut ids: Vec<_> = self
            .workers
            .lock()
            .await
            .iter()
            .filter(|(_, worker)| !worker.join.is_finished())
            .map(|(id, _)| id.clone())
            .collect();
        ids.extend(
            self.command_workers
                .lock()
                .await
                .iter()
                .filter(|(_, job)| !job.is_finished())
                .map(|(id, _)| id.clone()),
        );
        ids.extend(
            self.terminal_workers
                .lock()
                .await
                .iter()
                .filter(|(_, job)| !job.is_finished())
                .map(|(id, _)| id.clone()),
        );
        ids.extend(self.files.active_ids());
        ids
    }
    pub async fn prepare_update(&self, expected: &[String]) -> Result<(), String> {
        self.update_installing
            .store(true, std::sync::atomic::Ordering::SeqCst);
        let expected: BTreeSet<_> = expected.iter().cloned().collect();
        let actual: BTreeSet<_> = self.active_work_ids().await.into_iter().collect();
        if actual != expected {
            return Err("activityChanged".into());
        }
        self.files.shutdown().await;
        if self.files.unresolved_direct() {
            return Err("cleanupFailed".into());
        }
        self.stop_all_checked().await
    }
    fn allow_launch(&self) -> Result<(), String> {
        if self.shutting_down.load(std::sync::atomic::Ordering::SeqCst) {
            Err(crate::native_message::plain("exiting"))
        } else if self.update_installing() {
            Err("updateInstalling".into())
        } else {
            Ok(())
        }
    }
    pub fn wake_sender(&self) -> tokio::sync::watch::Sender<u64> {
        self.wake.clone()
    }
    pub fn power_unavailable(&self) {
        self.power_missing
            .store(true, std::sync::atomic::Ordering::Relaxed);
    }
    pub async fn auto_connect(self: &Arc<Self>, app: &tauri::AppHandle) {
        let snapshot = self.snapshot();
        for rule in snapshot.rules.into_iter().filter(|r| r.auto_connect) {
            if self.allow_launch().is_err() {
                break;
            }
            let id = rule.id.clone();
            let host_snapshot = snapshot
                .hosts
                .iter()
                .find(|h| h.id == rule.host_id)
                .and_then(|h| h.login(rule.login_identity_id.as_deref()).ok());
            let service_ids = snapshot
                .services
                .iter()
                .filter(|s| s.rule_ids.contains(&id))
                .map(|s| s.id.clone())
                .collect();
            if let Err(message) = launch(
                self.clone(),
                app.clone(),
                rule,
                false,
                false,
                Default::default(),
            )
            .await
            {
                let runtime = Runtime {
                    rule_id: id.clone(),
                    run_id: uuid::Uuid::new_v4().to_string(),
                    host_snapshot,
                    service_ids,
                    status: "needs-attention".into(),
                    error_kind: Some(FailureKind::Configuration),
                    message,
                    ..Default::default()
                };
                self.activity.lock().unwrap().observe(&runtime);
                self.runtimes.lock().unwrap().insert(id, runtime);
                self.publish(app);
            }
        }
    }
    pub async fn stop_all(&self) {
        let _ = self.stop_all_checked().await;
    }
    async fn stop_all_checked(&self) -> Result<(), String> {
        let mut workers = self.workers.lock().await;
        self.commands.cancel_all();
        self.terminals.cancel_all();
        let terminal_jobs = std::mem::take(&mut *self.terminal_workers.lock().await);
        let command_jobs = std::mem::take(&mut *self.command_workers.lock().await);
        let jobs = std::mem::take(&mut *workers);
        for worker in jobs.values() {
            worker.cancel.cancel();
        }
        let mut failed = false;
        for (_, worker) in jobs {
            failed |= worker.join.await.is_err();
        }
        for (_, job) in terminal_jobs {
            failed |= job.await.is_err();
        }
        for (_, job) in command_jobs {
            failed |= job.await.is_err();
        }
        self.trust.lock().unwrap().clear();
        let ids = self
            .runtimes
            .lock()
            .unwrap()
            .keys()
            .cloned()
            .collect::<Vec<_>>();
        self.settle_stopped(&ids);
        if failed {
            Err("cleanup".into())
        } else {
            Ok(())
        }
    }
    pub(crate) fn workspace_terminals(
        &self,
        scope: &crate::workspace::Scope,
    ) -> Vec<crate::terminal::Session> {
        self.terminals
            .list()
            .into_iter()
            .filter(|s| scope.check(&s.id).is_ok())
            .collect()
    }
    pub(crate) fn workspace_files(&self) -> crate::files::Snapshot {
        self.files.snapshot()
    }
    pub(crate) fn close_workspace(&self, scope: &crate::workspace::Scope) {
        for s in self
            .terminals
            .list()
            .into_iter()
            .filter(|s| scope.owns(&s.id))
        {
            let _ = self.terminals.detach(&s.id, &s.client_id);
        }
        if !scope.main() {
            let ids: Vec<_> = self
                .files
                .sessions
                .lock()
                .unwrap()
                .keys()
                .filter(|id| scope.owns(id))
                .cloned()
                .collect();
            for id in ids {
                file_api::disconnect(self, &id);
                self.files.sessions.lock().unwrap().remove(&id);
                self.files.route_keys.lock().unwrap().remove(&id);
            }
            self.files.publish();
        }
    }
    pub fn close_to_tray(&self) -> bool {
        self.config.lock().unwrap().close_to_tray
    }
    pub async fn cancel_host_tests_on_hide(&self) {
        let mut workers = self.workers.lock().await;
        let ids: Vec<_> = workers
            .keys()
            .filter(|id| id.starts_with("host-test:"))
            .cloned()
            .collect();
        let mut jobs = Vec::new();
        for id in &ids {
            if let Some(worker) = workers.remove(id) {
                worker.cancel.cancel();
                jobs.push(worker);
            }
            self.trust.lock().unwrap().remove(id);
        }
        for worker in jobs {
            let _ = worker.join.await;
        }
        self.settle_stopped(&ids);
    }
    fn settle_stopped(&self, ids: &[String]) {
        for id in ids {
            self.generations.lock().unwrap().remove(id);
            let updated = {
                let mut runtimes = self.runtimes.lock().unwrap();
                runtimes.get_mut(id).map(|r| {
                    let changed = r.status != "stopped";
                    r.status = "stopped".into();
                    r.desired_running = false;
                    r.retry_at = None;
                    r.error_kind = None;
                    r.message.clear();
                    r.connections = 0;
                    if r.sent_per_second.is_some() {
                        r.sent_per_second = Some(0);
                    }
                    if r.received_per_second.is_some() {
                        r.received_per_second = Some(0);
                    }
                    (changed, r.clone())
                })
            };
            if let Some((true, runtime)) = updated {
                self.activity.lock().unwrap().observe(&runtime);
            }
        }
    }
    fn remove_rule(&self, id: &str) -> Result<(), String> {
        self.remove_rules(&[id.to_string()])
    }
    fn remove_rules(&self, ids: &[String]) -> Result<(), String> {
        let ids: std::collections::BTreeSet<_> = ids.iter().collect();
        if ids.is_empty() {
            return Err(crate::native_message::plain("selectDeleteRules"));
        }
        let mut c = self.config.lock().unwrap();
        let mut next = c.clone();
        let removed: Vec<_> = next
            .rules
            .iter()
            .filter(|r| ids.contains(&r.id))
            .cloned()
            .collect();
        if removed.len() != ids.len() {
            return Err(crate::native_message::plain("rulesDisappeared"));
        }
        next.rules.retain(|r| !ids.contains(&r.id));
        self.persist(&next)?;
        *c = next;
        remember_deletion(
            &mut self.deleted.lock().unwrap().forwards,
            DeletedForwards {
                rules: removed,
                removed_hosts: BTreeSet::new(),
            },
        );
        Ok(())
    }
    fn deletion_hosts(&self, config: &Config) -> Vec<Host> {
        let mut hosts = self.discovery.lock().unwrap().hosts.clone();
        hosts.extend(config.hosts.iter().cloned());
        hosts.extend(config.host_snapshots.values().cloned());
        hosts
    }
    fn host_deletion_impact(
        &self,
        c: &Config,
        id: &str,
        hosts: &[Host],
    ) -> Result<HostDeletionImpact, String> {
        if hosts.iter().any(|host| {
            host.id != id
                && (c.hosts.iter().any(|saved| saved.id == host.id)
                    || c.host_metadata.contains_key(&host.id))
                && rule_uses_host(
                    &Rule {
                        host_id: host.id.clone(),
                        ..Default::default()
                    },
                    hosts,
                    id,
                )
        }) {
            return Err(crate::native_message::plain("hostJumpInUse"));
        }
        let rules: Vec<_> = c
            .rules
            .iter()
            .filter(|r| rule_uses_host(r, hosts, id))
            .cloned()
            .collect();
        if !c.hosts.iter().any(|h| h.id == id)
            && !c.host_metadata.contains_key(id)
            && rules.is_empty()
        {
            return Err(crate::native_message::plain("hostNotAdded"));
        }
        let rule_ids: BTreeSet<_> = rules.iter().map(|rule| &rule.id).collect();
        let services = c
            .services
            .iter()
            .filter_map(|service| {
                let owns_host = service.host_ids.iter().any(|host_id| host_id == id);
                let loses_rule = service
                    .rule_ids
                    .iter()
                    .any(|rule_id| rule_ids.contains(rule_id));
                if !owns_host && !loses_rule && !service.login_by_host.contains_key(id) {
                    return None;
                }
                let owns_direct_rule = rules
                    .iter()
                    .any(|rule| rule.host_id == id && service.rule_ids.contains(&rule.id));
                let remove = (owns_host || (service.host_ids.is_empty() && owns_direct_rule))
                    && service.host_ids.iter().all(|host_id| host_id == id)
                    && !c.rules.iter().any(|rule| {
                        !rule_ids.contains(&rule.id) && service.rule_ids.contains(&rule.id)
                    });
                Some(HostDeletionService {
                    id: service.id.clone(),
                    name: service.name.clone(),
                    revision: service.revision.clone(),
                    remove,
                })
            })
            .collect();
        Ok(HostDeletionImpact {
            rules,
            services,
            active: self.host_busy_reason(id).is_some(),
        })
    }

    async fn stop_host_work(
        &self,
        id: &str,
        expected_rule_ids: &[String],
        expected_services: &[HostDeletionService],
    ) -> Result<(), String> {
        // Validate the user's confirmation before stopping anything, and recheck
        // the dependency list in remove_host before persisting the deletion.
        let mut workers = self.workers.lock().await;
        {
            let config = self.config.lock().unwrap();
            self.host_deletion_impact(&config, id, &self.deletion_hosts(&config))?
                .check(expected_rule_ids, expected_services)?;
        }
        self.files.stop_host_transfers(id).await?;
        for sid in self.files.host_activity(id).0 {
            file_api::disconnect(self, &sid);
        }
        let mut joins = Vec::new();
        for run in self
            .commands
            .list()
            .into_iter()
            .filter(|r| r.active() && r.route_host_ids.iter().any(|h| h == id))
        {
            self.commands.cancel(&run.id)?;
            if let Some(join) = self.command_workers.lock().await.remove(&run.id) {
                joins.push(join);
            }
        }
        for session in self
            .terminals
            .list()
            .into_iter()
            .filter(|s| s.active() && s.route_host_ids.iter().any(|h| h == id))
        {
            self.terminals.cancel(&session.id, &session.client_id)?;
            if let Some(join) = self.terminal_workers.lock().await.remove(&session.id) {
                joins.push(join);
            }
        }
        clear_deleted_sessions(self, &mut workers, &[format!("host-test:{id}")]).await;
        // Service workflows can acquire the worker lock while unwinding.
        drop(workers);
        for job in joins {
            job.await.map_err(|_| "cleanupFailed".to_string())?;
        }
        Ok(())
    }
    fn host_busy_reason(&self, id: &str) -> Option<&'static str> {
        if self.files.busy_host(id) {
            return Some("hostUsedByFiles");
        }
        if self
            .commands
            .list()
            .iter()
            .any(|r| r.active() && r.route_host_ids.iter().any(|h| h == id))
        {
            return Some("hostUsedByService");
        }
        if self
            .terminals
            .list()
            .iter()
            .any(|session| session.active() && session.route_host_ids.iter().any(|used| used == id))
        {
            return Some("hostUsedByTerminal");
        }
        None
    }
    fn remove_host(
        &self,
        id: &str,
        expected_rule_ids: &[String],
        expected_services: &[HostDeletionService],
    ) -> Result<Vec<String>, String> {
        if let Some(reason) = self.host_busy_reason(id) {
            return Err(reason.into());
        }
        if self
            .runtimes
            .lock()
            .unwrap()
            .get(&format!("host-test:{id}"))
            .is_some_and(|r| {
                !matches!(
                    r.status.as_str(),
                    "tested" | "failed" | "stopped" | "needs-attention"
                )
            })
        {
            return Err(crate::native_message::plain("hostTestRunning"));
        }
        let mut c = self.config.lock().unwrap();
        let hosts = self.deletion_hosts(&c);
        let impact = self.host_deletion_impact(&c, id, &hosts)?;
        impact.check(expected_rule_ids, expected_services)?;
        let rules = impact.rules;
        let ids: Vec<_> = rules.iter().map(|r| r.id.clone()).collect();
        let mut next = c.clone();
        let mut services = Vec::new();
        next.services.retain_mut(|service| {
            let Some(change) = impact.services.iter().find(|item| item.id == service.id) else {
                return true;
            };
            if change.remove {
                services.push(DeletedHostService::Removed(Box::new(service.clone())));
                return false;
            }
            let had_host = service.host_ids.iter().any(|host_id| host_id == id);
            let rule_ids = service
                .rule_ids
                .iter()
                .filter(|rule_id| ids.contains(rule_id))
                .cloned()
                .collect();
            let login_id = service.login_by_host.remove(id);
            // Shared service actions keep their revision so work on other hosts can finish.
            service.host_ids.retain(|host_id| host_id != id);
            service.rule_ids.retain(|rule_id| !ids.contains(rule_id));
            services.push(DeletedHostService::Detached {
                id: service.id.clone(),
                had_host,
                rule_ids,
                login_id,
            });
            true
        });
        let host = DeletedHost {
            id: id.into(),
            manual: c.hosts.iter().find(|h| h.id == id).cloned(),
            metadata: c.host_metadata.get(id).cloned(),
            snapshot: c.host_snapshots.get(id).cloned(),
            hidden: c.hidden_hosts.iter().any(|h| h == id),
            services,
        };
        next.rules.retain(|r| !ids.contains(&r.id));
        next.hosts.retain(|h| h.id != id);
        next.host_snapshots.remove(id);
        next.host_metadata.remove(id);
        next.hidden_hosts.retain(|host_id| host_id != id);
        self.persist(&next)?;
        *c = next;
        let mut deleted = self.deleted.lock().unwrap();
        for batch in &mut deleted.forwards {
            if batch
                .rules
                .iter()
                .any(|rule| rule_uses_host(rule, &hosts, id))
            {
                batch.removed_hosts.insert(id.to_owned());
            }
        }
        remember_deletion(&mut deleted.hosts, (host, rules));
        Ok(ids)
    }
    fn restore_deletion(&self, kind: DeletionKind) -> Result<(), String> {
        let mut config = self.config.lock().unwrap();
        let mut deleted = self.deleted.lock().unwrap();
        let empty = || crate::native_message::plain("nothingToUndo");
        let (host, rules) = match kind {
            DeletionKind::Host => {
                let (host, rules) = deleted.hosts.last().ok_or_else(empty)?;
                (Some(host), rules)
            }
            DeletionKind::Forward => {
                let batch = deleted.forwards.last().ok_or_else(empty)?;
                if batch.removed_hosts.iter().any(|id| {
                    !config.hosts.iter().any(|h| &h.id == id)
                        && !config.host_metadata.contains_key(id)
                }) {
                    return Err(crate::native_message::plain("restoreForwardHostFirst"));
                }
                (None, &batch.rules)
            }
        };
        if config
            .rules
            .iter()
            .any(|r| rules.iter().any(|old| old.id == r.id))
        {
            return Err(crate::native_message::plain("ruleIdUsed"));
        }
        let mut next = config.clone();
        if let Some(host) = host {
            if next.hosts.iter().any(|h| h.id == host.id)
                || next.host_metadata.contains_key(&host.id)
            {
                return Err(crate::native_message::plain("hostIdUsed"));
            }
            if let Some(manual) = &host.manual {
                next.hosts.push(manual.clone());
            }
            if let Some(metadata) = &host.metadata {
                next.host_metadata.insert(host.id.clone(), metadata.clone());
            }
            if let Some(snapshot) = &host.snapshot {
                next.host_snapshots
                    .insert(host.id.clone(), snapshot.clone());
            }
            if host.hidden {
                next.hidden_hosts.push(host.id.clone());
            }
            for service in &host.services {
                match service {
                    DeletedHostService::Removed(service) => {
                        if next.services.iter().any(|saved| saved.id == service.id) {
                            return Err(crate::native_message::plain("restoreServiceConflict"));
                        }
                        if next.services.len() >= 256 {
                            return Err("commandLimit".into());
                        }
                        let mut restored = (**service).clone();
                        restored.revision = uuid::Uuid::new_v4().to_string();
                        next.services.push(restored);
                    }
                    DeletedHostService::Detached {
                        id,
                        had_host,
                        rule_ids,
                        login_id,
                    } => {
                        if let Some(service) =
                            next.services.iter_mut().find(|saved| &saved.id == id)
                        {
                            if *had_host && !service.host_ids.contains(&host.id) {
                                service.host_ids.push(host.id.clone());
                            }
                            for rule_id in rule_ids {
                                if !service.rule_ids.contains(rule_id) {
                                    service.rule_ids.push(rule_id.clone());
                                }
                            }
                            if let Some(login_id) = login_id {
                                service
                                    .login_by_host
                                    .entry(host.id.clone())
                                    .or_insert_with(|| login_id.clone());
                            }
                            service.validate()?;
                        }
                    }
                }
            }
        }
        next.rules.extend(rules.iter().cloned().map(|mut rule| {
            rule.auto_connect = false;
            rule
        }));
        self.persist(&next)?;
        *config = next;
        match kind {
            DeletionKind::Host => {
                let (host, _) = deleted.hosts.pop().unwrap();
                for batch in &mut deleted.forwards {
                    batch.removed_hosts.remove(&host.id);
                }
            }
            DeletionKind::Forward => {
                deleted.forwards.pop();
            }
        }
        Ok(())
    }
    fn reconcile_hosts(&self, mut next: ssh_config::Discovery) -> Result<bool, String> {
        let mut config = self.config.lock().unwrap();
        let mut current = self.discovery.lock().unwrap();
        if !next.diagnostics.is_empty() {
            for old in &current.hosts {
                if !next.hosts.iter().any(|h| h.id == old.id) {
                    let mut host = old.clone();
                    if !host.diagnostics.iter().any(|d| {
                        crate::native_message::key(d).as_deref() == Some("sourceSyncFailed")
                    }) {
                        host.diagnostics
                            .push(crate::native_message::plain("sourceSyncFailed"));
                    }
                    next.hosts.push(host);
                }
            }
        }
        if next.diagnostics.is_empty() {
            let rule_hosts: BTreeSet<_> = config.rules.iter().map(|r| &r.host_id).collect();
            let changes: Vec<_> = next
                .hosts
                .iter()
                .filter(|host| {
                    (rule_hosts.contains(&host.id) || config.host_metadata.contains_key(&host.id))
                        && config.host_snapshots.get(&host.id) != Some(*host)
                })
                .collect();
            if !changes.is_empty() {
                let mut saved = config.clone();
                for host in changes {
                    saved.host_snapshots.insert(host.id.clone(), host.clone());
                }
                self.persist(&saved)?;
                *config = saved;
            }
        }
        if next == *current {
            return Ok(false);
        }
        *current = next;
        Ok(true)
    }
    fn scan_current_sources(&self) -> bool {
        let sources = self.config.lock().unwrap().source_files.clone();
        match self.reconcile_hosts(ssh_config::discover_with(&sources)) {
            Ok(changed) => changed,
            Err(error) => {
                let mut discovery = self.discovery.lock().unwrap();
                let message = crate::native_message::message(
                    "sourceSaveFailed",
                    serde_json::json!({"error": (error).to_string()}),
                );
                if discovery.diagnostics.contains(&message) {
                    return false;
                }
                discovery.diagnostics.push(message);
                true
            }
        }
    }
    pub fn poll_hosts(&self, app: &tauri::AppHandle) {
        let Ok(_scan) = self.source_scan.try_lock() else {
            return;
        };
        let enabled = self.config.lock().unwrap().auto_sync_hosts;
        if enabled && self.scan_current_sources() {
            self.publish(app);
        }
    }
}
#[tauri::command]
pub async fn set_host_sources(
    state: tauri::State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    files: Vec<String>,
    auto_sync: bool,
) -> Result<Snapshot, String> {
    let files: Vec<_> = files
        .into_iter()
        .map(|path| path.trim().to_string())
        .filter(|path| !path.is_empty())
        .collect();
    if files.iter().any(|path| {
        !std::path::Path::new(path).is_absolute()
            && !path.starts_with("~/")
            && !path.starts_with("~\\")
    }) {
        return Err(crate::native_message::plain("sourceAbsolutePath"));
    }
    let state = state.inner().clone();
    tokio::task::spawn_blocking(move || {
        let _scan = state.source_scan.lock().unwrap();
        {
            let mut c = state.config.lock().unwrap();
            let mut next = c.clone();
            next.source_files = files;
            next.auto_sync_hosts = auto_sync;
            state.persist(&next)?;
            *c = next;
        }
        state.scan_current_sources();
        state.publish(&app);
        Ok(state.snapshot())
    })
    .await
    .map_err(|err| err.to_string())?
}
#[tauri::command]
pub fn add_discovered_hosts(
    state: tauri::State<Arc<AppState>>,
    app: tauri::AppHandle,
    ids: Vec<String>,
) -> Result<Snapshot, String> {
    state.add_discovered_hosts(&ids)?;
    state.publish(&app);
    Ok(state.snapshot())
}
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HostLogins {
    identities: Vec<crate::model::LoginIdentity>,
    #[serde(default)]
    credential_ids: Vec<String>,
    default_id: Option<String>,
    password_edit: Option<HostPasswordEdit>,
}

#[tauri::command]
pub fn save_login_credential(
    state: tauri::State<Arc<AppState>>,
    app: tauri::AppHandle,
    credential: LoginIdentity,
    password: Option<String>,
    clear_password: Option<bool>,
) -> Result<Snapshot, String> {
    state.save_login_credential(
        credential,
        password.map(tunnel::Secret::from),
        clear_password.unwrap_or(false),
    )?;
    state.publish(&app);
    Ok(state.snapshot())
}

#[tauri::command]
pub fn login_credential_password_status(
    state: tauri::State<Arc<AppState>>,
    id: String,
) -> Result<PasswordStatus, String> {
    let config = state.config.lock().unwrap();
    let credential = config
        .login_credentials
        .get(&id)
        .ok_or_else(|| crate::native_message::plain("loginIdentityMissing"))?;
    let result = state.vault.credential(credential).read();
    Ok(PasswordStatus {
        id,
        supported: crate::credentials::SUPPORTED,
        saved: result.as_ref().is_ok_and(|password| password.is_some()),
        error: result.err(),
    })
}

#[tauri::command]
pub fn delete_login_credential(
    state: tauri::State<Arc<AppState>>,
    app: tauri::AppHandle,
    id: String,
) -> Result<Snapshot, String> {
    state.delete_login_credential(&id)?;
    state.publish(&app);
    Ok(state.snapshot())
}

#[tauri::command]
pub fn save_host_metadata(
    state: tauri::State<Arc<AppState>>,
    app: tauri::AppHandle,
    id: String,
    name: String,
    tags: Vec<String>,
    appearance: Option<HostAppearance>,
    login_settings: Option<HostLogins>,
) -> Result<Snapshot, String> {
    if let Some(style) = &appearance {
        style.validate()?;
    }
    if name.trim().is_empty() {
        return Err(crate::native_message::plain("hostNameEmpty"));
    }
    let mut host = state
        .snapshot()
        .hosts
        .into_iter()
        .find(|h| h.id == id && h.source == "config")
        .ok_or(crate::native_message::plain("sourceMetadataOnly"))?;
    {
        let mut c = state.config.lock().unwrap();
        let mut next = c.clone();
        let previous_ids = std::mem::take(&mut host.credential_ids);
        let password_edit = if let Some(logins) = login_settings {
            host.logins = logins.identities;
            host.credential_ids = logins.credential_ids;
            host.default_login_id = logins.default_id;
            logins.password_edit
        } else {
            host.credential_ids.clone_from(&previous_ids);
            None
        };
        clear_projected_credentials(&mut host, &previous_ids);
        let mut effective = host.clone();
        project_credentials(&next, &mut effective)?;
        state.validate_host_credentials(&next, &effective)?;
        next.host_snapshots.insert(id.clone(), host.clone());
        next.host_metadata.insert(
            id,
            HostMetadata {
                logins: host.logins,
                credential_ids: host.credential_ids,
                default_login_id: host.default_login_id,
                name,
                appearance,
                tags: tags
                    .into_iter()
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty())
                    .collect(),
            },
        );
        state.persist_host_edit(&next, &effective, password_edit)?;
        *c = next;
    }
    state.publish(&app);
    Ok(state.snapshot())
}
#[tauri::command]
pub fn snapshot(state: tauri::State<Arc<AppState>>) -> Snapshot {
    state.snapshot()
}
#[tauri::command]
pub async fn refresh_hosts(
    state: tauri::State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    manual: Option<bool>,
) -> Result<Snapshot, String> {
    let state = state.inner().clone();
    tokio::task::spawn_blocking(move || {
        if manual.unwrap_or(true) {
            let _scan = state.source_scan.lock().unwrap();
            if state.scan_current_sources() {
                state.publish(&app);
            }
        } else {
            state.poll_hosts(&app);
        }
        state.snapshot()
    })
    .await
    .map_err(|err| err.to_string())
}
#[tauri::command]
pub fn save_host(
    state: tauri::State<Arc<AppState>>,
    app: tauri::AppHandle,
    host: Host,
    password_edit: Option<HostPasswordEdit>,
) -> Result<Snapshot, String> {
    state.upsert_host(host, password_edit)?;
    state.publish(&app);
    Ok(state.snapshot())
}
fn save_rule_profile(
    state: &AppState,
    mut rule: Rule,
    service_links: Option<Vec<command_api::ServiceLink>>,
) -> Result<(), String> {
    let host = state
        .snapshot()
        .hosts
        .into_iter()
        .find(|h| h.id == rule.host_id)
        .ok_or(crate::native_message::plain("selectHostSource"))?;
    if !host.diagnostics.is_empty() {
        return Err(crate::native_message::combine(&host.diagnostics, "\n"));
    }
    if rule.id.is_empty() {
        rule.id = uuid::Uuid::new_v4().to_string()
    }
    {
        let mut c = state.config.lock().unwrap();
        let mut next = c.clone();
        let effective = current_host_credentials(&next, &host)?;
        rule.resolve_host_login(&effective);
        if let Some(links) = service_links {
            let changed =
                command_api::bind_rule_services(&mut next, &rule.id, &rule.host_id, &links)?;
            if changed.iter().any(|id| {
                state.terminals.busy(id)
                    || state
                        .commands
                        .list()
                        .iter()
                        .any(|r| &r.service_id == id && r.active())
            }) {
                return Err("serviceBusy".into());
            }
        }
        let bound: Vec<_> = next
            .services
            .iter()
            .filter(|s| s.rule_ids.contains(&rule.id))
            .collect();
        if bound.iter().any(|s| !s.host_ids.contains(&rule.host_id)) {
            return Err("serviceUnbound".into());
        }
        if rule.kind != ForwardKind::D && !bound.is_empty() {
            if bound.len() != 1 {
                return Err("invalidService".into());
            }
            let port = bound[0]
                .port
                .ok_or(crate::native_message::plain("servicePort"))?;
            if rule.kind == ForwardKind::L {
                rule.target_port = port;
            } else {
                rule.bind_port = port;
            }
        }
        effective.login(rule.login_identity_id.as_deref())?;
        rule.validate()?;
        next.host_snapshots
            .insert(host.id, host_checkpoint(effective));
        next.rules.retain(|r| r.id != rule.id);
        next.rules.push(rule);
        state.persist(&next)?;
        *c = next;
    }
    Ok(())
}
#[tauri::command]
pub fn save_rule(
    state: tauri::State<Arc<AppState>>,
    app: tauri::AppHandle,
    rule: Rule,
    service_links: Option<Vec<command_api::ServiceLink>>,
) -> Result<Snapshot, String> {
    save_rule_profile(&state, rule, service_links)?;
    state.publish(&app);
    Ok(state.snapshot())
}
#[tauri::command]
pub async fn start_rule(
    state: tauri::State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    id: String,
    login_id: Option<String>,
    secret: String,
    jump_secrets: Option<BTreeMap<String, String>>,
    remember_host_ids: Option<Vec<String>>,
) -> Result<(), String> {
    let rule = state
        .snapshot()
        .rules
        .into_iter()
        .find(|r| r.id == id)
        .ok_or(crate::native_message::plain("ruleMissing"))?;
    if login_id.as_ref().is_some_and(|id| {
        Some(id) != rule.login_identity_id.as_ref()
            && !(rule.login_identity_id.is_none() && *id == primary_login_id(&rule.host_id))
    }) {
        return Err("forwardChanged".into());
    }
    launch(
        state.inner().clone(),
        app,
        rule,
        false,
        true,
        LoginCredentials {
            secret: secret.into(),
            jumps: jump_secrets
                .unwrap_or_default()
                .into_iter()
                .map(|(id, s)| (id, s.into()))
                .collect(),
            remember: remember_host_ids.unwrap_or_default().into_iter().collect(),
        },
    )
    .await
}
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PasswordStatus {
    id: String,
    supported: bool,
    saved: bool,
    error: Option<String>,
}
#[tauri::command]
pub fn password_status(
    state: tauri::State<Arc<AppState>>,
    window: tauri::WebviewWindow,
    ids: Vec<String>,
    login_id: Option<String>,
) -> Result<Vec<PasswordStatus>, String> {
    let scope = crate::workspace::scope(&window)?;
    let snapshot = state.snapshot();
    let config = state.config.lock().unwrap();
    Ok(snapshot
        .hosts
        .iter()
        .filter(|h| {
            ids.contains(&h.id) && (scope.main() || snapshot.added_host_ids.contains(&h.id))
        })
        .map(|host| {
            let login = current_host_credentials(&config, host)
                .and_then(|host| host.login(login_id.as_deref()));
            let key = login.as_ref().ok().map(Host::login_id);
            let result = login.and_then(|login| state.vault.primary(&login).read());
            PasswordStatus {
                id: host.id.clone(),
                supported: crate::credentials::SUPPORTED,
                saved: result.as_ref().is_ok_and(|s| s.is_some()),
                error: result.err().or_else(|| {
                    let key = key?;
                    state
                        .credential_errors
                        .lock()
                        .unwrap()
                        .get(&(host.id.clone(), key))
                        .cloned()
                }),
            }
        })
        .collect())
}
#[tauri::command]
pub fn clear_password(
    state: tauri::State<Arc<AppState>>,
    window: tauri::WebviewWindow,
    id: String,
    login_id: Option<String>,
) -> Result<(), String> {
    let scope = crate::workspace::scope(&window)?;
    let snapshot = state.snapshot();
    let host = snapshot
        .hosts
        .into_iter()
        .find(|h| h.id == id && (scope.main() || snapshot.added_host_ids.contains(&id)))
        .ok_or(crate::native_message::plain("hostMissing"))?;
    let login = host.login(login_id.as_deref())?;
    state.vault.primary(&login).forget()?;
    state
        .credential_errors
        .lock()
        .unwrap()
        .remove(&(id, login.login_id()));
    Ok(())
}
// Product action: invoked only after the user clicks Test connection, never by discovery.
#[tauri::command]
pub async fn test_host(
    state: tauri::State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    id: String,
    login_id: Option<String>,
    secret: String,
    jump_secrets: Option<BTreeMap<String, String>>,
    remember_host_ids: Option<Vec<String>>,
) -> Result<(), String> {
    let rule = Rule {
        id: format!("host-test:{id}"),
        name: crate::native_message::plain("hostTestName"),
        host_id: id,
        login_identity_id: login_id,
        bind_port: 1,
        target_host: "127.0.0.1".into(),
        target_port: 1,
        background: false,
        ..Default::default()
    };
    launch(
        state.inner().clone(),
        app,
        rule,
        true,
        true,
        LoginCredentials {
            secret: secret.into(),
            jumps: jump_secrets
                .unwrap_or_default()
                .into_iter()
                .map(|(id, s)| (id, s.into()))
                .collect(),
            remember: remember_host_ids.unwrap_or_default().into_iter().collect(),
        },
    )
    .await
}
async fn launch(
    state: Arc<AppState>,
    app: tauri::AppHandle,
    rule: Rule,
    test_only: bool,
    interactive: bool,
    credentials: LoginCredentials,
) -> Result<(), String> {
    launch_impl(state, app, rule, test_only, interactive, credentials, None).await
}
async fn launch_impl(
    state: Arc<AppState>,
    app: tauri::AppHandle,
    rule: Rule,
    test_only: bool,
    interactive: bool,
    credentials: LoginCredentials,
    expected_route: Option<Vec<Host>>,
) -> Result<(), String> {
    rule.check_login_id()?;
    let id = rule.id.clone();
    let mut workers = state.workers.lock().await;
    state.allow_launch()?;
    if expected_route.is_some() {
        if let Some(old) = workers.get(&id).filter(|w| !w.join.is_finished()) {
            return Err(if old.rule.same_connection(&rule) {
                "forwardAlreadyActive"
            } else {
                "forwardChanged"
            }
            .into());
        }
    }
    let verify_saved_rule = |snapshot: &Snapshot| -> Result<(), String> {
        if test_only {
            return Ok(());
        }
        let saved = snapshot.rules.iter().find(|saved| saved.id == id);
        match saved {
            Some(saved) if saved.same_connection(&rule) => Ok(()),
            Some(_) => Err("forwardChanged".into()),
            None if expected_route.is_some() => Err("forwardChanged".into()),
            None => Err(crate::native_message::plain("ruleDeleted")),
        }
    };
    let snapshot = state.snapshot();
    verify_saved_rule(&snapshot)?;
    let snapshot = if let Some(old) = workers.remove(&id) {
        old.cancel.cancel();
        let _ = old.join.await;
        let current = state.snapshot();
        verify_saved_rule(&current)?;
        current
    } else {
        snapshot
    };
    state.trust.lock().unwrap().remove(&id);
    let hosts = snapshot.hosts;
    let host = hosts
        .iter()
        .find(|h| h.id == rule.host_id)
        .cloned()
        .ok_or(crate::native_message::plain("hostSourceMissing"))?
        .login(rule.login_identity_id.as_deref())?;
    if !host.diagnostics.is_empty() {
        return Err(crate::native_message::combine(&host.diagnostics, "\n"));
    }
    let host_key = format!("{}:{}", host.address, host.port);
    let jumps = resolve_jumps(&hosts, &host)?;
    if let Some(expected) = expected_route {
        let actual: Vec<_> = jumps.iter().chain(std::iter::once(&host)).collect();
        if actual.len() != expected.len()
            || actual
                .iter()
                .zip(&expected)
                .any(|(a, b)| a.id != b.id || !a.same_connection(b))
        {
            return Err("forwardChanged".into());
        }
    }
    if !interactive {
        let config = state.config.lock().unwrap();
        for h in jumps.iter().chain(std::iter::once(&host)) {
            if h.auth_method == AuthMethod::Password
                || !config
                    .trusted_keys
                    .contains_key(&format!("{}:{}", h.address, h.port))
            {
                return Err(crate::native_message::plain("autoConnectAuth"));
            }
        }
    }
    let mut saves = BTreeMap::new();
    let mut prepare = |host: &Host, secret: tunnel::Secret| -> Result<tunnel::Secret, String> {
        let (secret, update) = state.vault.primary(host).prepare(
            secret,
            interactive,
            credentials.remember.contains(&host.id),
        )?;
        if let Some(epoch) = update {
            saves.insert(host.id.clone(), epoch);
        }
        Ok(secret)
    };
    let secret = prepare(&host, credentials.secret)?;
    let jump_secrets = credentials.jumps;
    let jumps: Vec<tunnel::HopRequest> = jumps
        .into_iter()
        .map(|host| {
            let expected = state
                .config
                .lock()
                .unwrap()
                .trusted_keys
                .get(&format!("{}:{}", host.address, host.port))
                .cloned();
            let secret = prepare(
                &host,
                jump_secrets.get(&host.id).cloned().unwrap_or_default(),
            )?;
            Ok(tunnel::HopRequest {
                host,
                secret,
                expected,
            })
        })
        .collect::<Result<_, String>>()?;
    let expected = state
        .config
        .lock()
        .unwrap()
        .trusted_keys
        .get(&host_key)
        .cloned();
    let run_id = uuid::Uuid::new_v4().to_string();
    state
        .runtime_rules
        .lock()
        .unwrap()
        .insert(id.clone(), rule.clone());
    state
        .generations
        .lock()
        .unwrap()
        .insert(id.clone(), run_id.clone());
    let cancel = CancellationToken::new();
    let notify = {
        let frozen_host = host.clone();
        let state = state.clone();
        let app = app.clone();
        let job_id = run_id.clone();
        let service_ids: Vec<_> = snapshot
            .services
            .iter()
            .filter(|s| s.rule_ids.contains(&id))
            .map(|s| s.id.clone())
            .collect();
        Arc::new(move |mut runtime: Runtime| {
            runtime
                .host_snapshot
                .get_or_insert_with(|| frozen_host.clone());
            runtime.service_ids.clone_from(&service_ids);
            {
                let mut generations = state.generations.lock().unwrap();
                if generations.get(&runtime.rule_id) != Some(&job_id) {
                    return;
                }
                if matches!(
                    runtime.status.as_str(),
                    "stopped" | "failed" | "tested" | "needs-attention"
                ) {
                    generations.remove(&runtime.rule_id);
                }
                state.activity.lock().unwrap().observe(&runtime);
                state
                    .runtimes
                    .lock()
                    .unwrap()
                    .insert(runtime.rule_id.clone(), runtime);
            }
            state.publish(&app);
        }) as tunnel::Notify
    };
    let prompt = {
        let state = state.clone();
        let app = app.clone();
        let id = id.clone();
        let run = run_id.clone();
        Arc::new(
            move |endpoint: String, fingerprint: String, tx: oneshot::Sender<bool>| {
                let generations = state.generations.lock().unwrap();
                if generations.get(&id) != Some(&run) {
                    return;
                }
                let current_run = state
                    .runtimes
                    .lock()
                    .unwrap()
                    .get(&id)
                    .map(|r| r.run_id.clone())
                    .unwrap_or_else(|| run.clone());
                state.trust.lock().unwrap().insert(
                    id.clone(),
                    PendingTrust {
                        run_id: current_run.clone(),
                        fingerprint: fingerprint.clone(),
                        endpoint: endpoint.clone(),
                        reply: tx,
                    },
                );
                let mut runtime = state
                    .runtimes
                    .lock()
                    .unwrap()
                    .get(&id)
                    .cloned()
                    .unwrap_or_default();
                runtime.rule_id = id.clone();
                runtime.run_id = current_run;
                runtime.status = "verifying-host".into();
                runtime.fingerprint = Some(fingerprint);
                runtime.message = crate::native_message::plain("firstHostKey");
                runtime.verification_endpoint = Some(endpoint);
                runtime.desired_running = true;
                state.activity.lock().unwrap().observe(&runtime);
                state.runtimes.lock().unwrap().insert(id.clone(), runtime);
                drop(generations);
                state.publish(&app);
            },
        ) as tunnel::TrustPrompt
    };
    let validate: crate::supervisor::Validate = {
        let frozen = std::iter::once(host.clone())
            .chain(jumps.iter().map(|h: &tunnel::HopRequest| h.host.clone()))
            .collect::<Vec<_>>();
        let state = state.clone();
        let frozen_rule = rule.clone();
        Arc::new(move || {
            let snapshot = state.snapshot();
            (test_only
                || snapshot
                    .rules
                    .iter()
                    .any(|r| r.id == frozen_rule.id && r.same_connection(&frozen_rule)))
                && frozen.iter().all(|before| {
                    snapshot.hosts.iter().any(|after| {
                        after.id == before.id
                            && after.diagnostics.is_empty()
                            && after.matches_login(before)
                    })
                })
        })
    };
    let observer: tunnel::PasswordObserver = {
        let state = state.clone();
        let app = app.clone();
        let id = id.clone();
        let run = run_id.clone();
        Arc::new(move |host, password, method| {
            let generations = state.generations.lock().unwrap();
            if generations.get(&id) != Some(&run) {
                return;
            }
            let Some(epoch) = saves.get(&host.id) else {
                return;
            };
            if !state.snapshot().hosts.iter().any(|current| {
                current.id == host.id
                    && current.diagnostics.is_empty()
                    && current.matches_login(host)
            }) {
                return;
            }
            let result = state.vault.primary(host).save(password, method, *epoch);
            let mut errors = state.credential_errors.lock().unwrap();
            match result {
                Ok(()) => {
                    errors.remove(&(host.id.clone(), host.login_id()));
                }
                Err(message) => {
                    let _ = app.emit("tunnel://password-error", &message);
                    errors.insert((host.id.clone(), host.login_id()), message);
                }
            }
        })
    };
    let active_rule = rule.clone();
    let join = tauri::async_runtime::spawn(crate::supervisor::run_with_password_observer(
        tunnel::RunRequest {
            host,
            rule,
            secret,
            expected,
            run_id,
            jumps,
            test_only,
        },
        cancel.clone(),
        state.wake.subscribe(),
        notify,
        prompt,
        validate,
        Some(observer),
    ));
    // Tauri returns its own JoinHandle, wrap it for a single task type.
    let join = tokio::spawn(async move {
        // Propagate task failure so update preparation cannot report successful cleanup.
        join.await.expect("SSH supervisor task failed");
    });
    workers.insert(
        id,
        Worker {
            rule: active_rule,
            cancel,
            join,
        },
    );
    Ok(())
}
#[derive(serde::Deserialize)]
pub struct LinkedServiceLaunch {
    id: String,
    revision: String,
    protocol: crate::service::DirectProtocol,
}
// Use the existing native shell opener, with a dedicated fixed-scheme boundary.
#[allow(deprecated)]
#[tauri::command]
pub async fn open_service(
    state: tauri::State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    id: String,
    internal_vnc: Option<bool>,
    service: Option<LinkedServiceLaunch>,
) -> Result<(), String> {
    let workers = state.workers.lock().await;
    let worker = workers
        .get(&id)
        .ok_or(crate::native_message::plain("startForward"))?;
    let snapshot = state.snapshot();
    let rule = snapshot
        .rules
        .iter()
        .find(|r| r.id == id)
        .ok_or(crate::native_message::plain("forwardMissing"))?;
    if !rule.same_connection(&worker.rule) {
        return Err(crate::native_message::plain("forwardChanged"));
    }
    let runtime = snapshot
        .runtimes
        .iter()
        .find(|r| r.rule_id == id)
        .ok_or(crate::native_message::plain("startForward"))?;
    let host = runtime
        .host_snapshot
        .as_ref()
        .ok_or(crate::native_message::plain("runningHostMissing"))?;
    let (url, vnc) = if let Some(link) = service {
        let profile = snapshot
            .services
            .iter()
            .find(|s| s.id == link.id && s.revision == link.revision)
            .filter(|_| rule.service_protocol.is_none())
            .ok_or("staleAction")?;
        (
            crate::service::linked_service_url(
                &snapshot.services,
                profile,
                rule,
                host,
                runtime,
                link.protocol,
            )?,
            link.protocol == crate::service::DirectProtocol::Vnc,
        )
    } else {
        (
            crate::service::service_url(rule, host, runtime)?,
            rule.service_protocol == Some(crate::model::ServiceProtocol::Vnc),
        )
    };
    drop(workers);
    if vnc {
        return crate::vnc::launch(
            &app,
            &url,
            rule.host_id.clone(),
            crate::vnc::SshContext::Forward(rule.id.clone()),
            internal_vnc == Some(true),
        );
    }
    open_service_url(&app, url)
}

#[allow(deprecated)]
fn open_service_url(app: &tauri::AppHandle, url: String) -> Result<(), String> {
    use tauri_plugin_shell::ShellExt;
    app.shell().open(url, None).map_err(|e| {
        crate::native_message::message(
            "openServiceFailed",
            serde_json::json!({"e": (e).to_string()}),
        )
    })
}
#[tauri::command]
pub async fn open_host_service(
    state: tauri::State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    host_id: String,
    service_id: String,
    revision: String,
    protocol: crate::service::DirectProtocol,
    internal_vnc: bool,
) -> Result<(), String> {
    let snapshot = state.snapshot();
    let service = snapshot
        .services
        .iter()
        .find(|s| s.id == service_id)
        .ok_or("serviceMissing")?;
    if service.revision != revision
        || service
            .direct_protocol
            .is_some_and(|saved| saved != protocol)
    {
        return Err("staleAction".into());
    }
    let (_, host) = service.execution_target(&snapshot, None, Some(&host_id))?;
    let url = crate::service::host_service_url(host, service.port, protocol)?;
    if protocol == crate::service::DirectProtocol::Vnc {
        let user = service
            .execution_login(host, None)
            .ok()
            .map(|host| host.user);
        return crate::vnc::launch(
            &app,
            &url,
            host_id,
            crate::vnc::SshContext::Direct(user),
            internal_vnc,
        );
    }
    open_service_url(&app, url)
}

#[tauri::command]
pub async fn open_proxy_browser(
    state: tauri::State<'_, Arc<AppState>>,
    id: String,
    browser: crate::proxy_browser::Browser,
    service_id: Option<String>,
) -> Result<(), String> {
    let workers = state.workers.lock().await;
    let worker = workers
        .get(&id)
        .ok_or(crate::native_message::plain("startForward"))?;
    let snapshot = state.snapshot();
    let rule = snapshot
        .rules
        .iter()
        .find(|r| r.id == id)
        .ok_or(crate::native_message::plain("forwardMissing"))?;
    let runtime = snapshot
        .runtimes
        .iter()
        .find(|r| r.rule_id == id)
        .ok_or(crate::native_message::plain("startForward"))?;
    let proxy = crate::proxy_browser::endpoint(rule, &worker.rule, runtime)?;
    let directory = state
        .path
        .parent()
        .ok_or(crate::native_message::plain("proxyBrowserFailed"))?;
    let url = service_id
        .map(|id| {
            let service = snapshot
                .services
                .iter()
                .find(|s| {
                    s.id == id
                        && s.rule_ids.contains(&rule.id)
                        && s.host_ids.contains(&rule.host_id)
                })
                .ok_or("serviceUnbound")?;
            let port = service.port.ok_or("servicePort")?;
            Ok::<_, &str>(format!("http://127.0.0.1:{port}/"))
        })
        .transpose()?;
    crate::proxy_browser::launch(directory, runtime, &proxy, browser, url.as_deref())
}

#[tauri::command]
pub async fn stop_rule(
    state: tauri::State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    id: String,
) -> Result<(), String> {
    state.commands.cancel_for_rule(&id);
    let mut workers = state.workers.lock().await;
    if let Some(worker) = workers.remove(&id) {
        worker.cancel.cancel();
        let _ = worker.join.await;
    }
    state.trust.lock().unwrap().remove(&id);
    state.settle_stopped(&[id]);
    state.publish(&app);
    Ok(())
}
#[tauri::command]
pub fn trust_host(
    window: tauri::WebviewWindow,
    state: tauri::State<Arc<AppState>>,
    id: String,
    run_id: String,
    fingerprint: String,
) -> Result<(), String> {
    let scope = crate::workspace::scope(&window)?;
    if !scope.main() && !(id.starts_with("terminal:") || id.starts_with("files:")) {
        return Err("unauthorizedWindow".into());
    }
    if id.starts_with("terminal:") || id.starts_with("files:") {
        scope.check(&id)?;
    }
    let mut trust = state.trust.lock().unwrap();
    let pending = trust
        .get(&id)
        .ok_or(crate::native_message::plain("trustExpired"))?;
    if pending.run_id != run_id || pending.fingerprint != fingerprint || pending.reply.is_closed() {
        return Err(crate::native_message::plain("trustReconnect"));
    }
    let endpoint = pending.endpoint.clone();
    {
        let mut c = state.config.lock().unwrap();
        let mut next = c.clone();
        next.trusted_keys.insert(endpoint, fingerprint);
        state.persist(&next)?;
        *c = next;
    }
    let pending = trust.remove(&id).unwrap();
    let _ = pending.reply.send(true);
    Ok(())
}
pub fn state(app: &tauri::AppHandle) -> Arc<AppState> {
    app.state::<Arc<AppState>>().inner().clone()
}
#[tauri::command]
pub fn set_close_to_tray(
    state: tauri::State<Arc<AppState>>,
    app: tauri::AppHandle,
    enabled: bool,
) -> Result<Snapshot, String> {
    {
        let mut c = state.config.lock().unwrap();
        let mut next = c.clone();
        next.close_to_tray = enabled;
        state.persist(&next)?;
        *c = next;
    }
    state.publish(&app);
    Ok(state.snapshot())
}
#[tauri::command]
pub fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}
#[tauri::command]
pub async fn preview_host_deletion(
    state: tauri::State<'_, Arc<AppState>>,
    id: String,
) -> Result<HostDeletionImpact, String> {
    let config = state.config.lock().unwrap();
    state.host_deletion_impact(&config, &id, &state.deletion_hosts(&config))
}
#[tauri::command]
pub async fn delete_host(
    state: tauri::State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    id: String,
    expected_rule_ids: Vec<String>,
    expected_services: Vec<HostDeletionService>,
    stop_active: Option<bool>,
) -> Result<Snapshot, String> {
    if stop_active == Some(true) {
        state
            .stop_host_work(&id, &expected_rule_ids, &expected_services)
            .await?;
    }
    let mut workers = state.workers.lock().await;
    let mut ids = state.remove_host(&id, &expected_rule_ids, &expected_services)?;
    ids.push(format!("host-test:{id}"));
    clear_deleted_sessions(&state, &mut workers, &ids).await;
    state.publish(&app);
    Ok(state.snapshot())
}
#[tauri::command]
pub fn hide_host(
    state: tauri::State<Arc<AppState>>,
    app: tauri::AppHandle,
    id: String,
    hidden: bool,
) -> Result<Snapshot, String> {
    {
        let mut c = state.config.lock().unwrap();
        let mut next = c.clone();
        next.hidden_hosts.retain(|h| h != &id);
        if hidden {
            next.hidden_hosts.push(id);
        }
        state.persist(&next)?;
        *c = next;
    }
    state.publish(&app);
    Ok(state.snapshot())
}
#[tauri::command]
pub async fn delete_rule(
    state: tauri::State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    id: String,
) -> Result<Snapshot, String> {
    let mut workers = state.workers.lock().await;
    state.remove_rule(&id)?;
    clear_deleted_sessions(&state, &mut workers, &[id]).await;
    state.publish(&app);
    Ok(state.snapshot())
}
#[tauri::command]
pub async fn delete_rules(
    state: tauri::State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    ids: Vec<String>,
) -> Result<Snapshot, String> {
    let mut workers = state.workers.lock().await;
    state.remove_rules(&ids)?;
    clear_deleted_sessions(&state, &mut workers, &ids).await;
    state.publish(&app);
    Ok(state.snapshot())
}
async fn clear_deleted_sessions(
    state: &AppState,
    workers: &mut BTreeMap<String, Worker>,
    ids: &[String],
) {
    let mut jobs = Vec::new();
    for id in ids {
        state.generations.lock().unwrap().remove(id);
        state.trust.lock().unwrap().remove(id);
        if let Some(worker) = workers.remove(id) {
            worker.cancel.cancel();
            jobs.push(worker);
        }
    }
    for worker in jobs {
        let _ = worker.join.await;
    }
    let mut runtimes = state.runtimes.lock().unwrap();
    for id in ids {
        runtimes.remove(id);
        state.runtime_rules.lock().unwrap().remove(id);
    }
}
#[tauri::command]
pub fn undo_delete(
    kind: DeletionKind,
    state: tauri::State<Arc<AppState>>,
    app: tauri::AppHandle,
) -> Result<Snapshot, String> {
    state.restore_deletion(kind)?;
    state.publish(&app);
    Ok(state.snapshot())
}
use crate::batch::BatchResult;
#[tauri::command]
pub async fn start_batch(
    state: tauri::State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    ids: Vec<String>,
    secrets: BTreeMap<String, String>,
    identity_keys: Option<bool>,
    remember_host_ids: Option<Vec<String>>,
) -> Result<Vec<BatchResult>, String> {
    let secrets: BTreeMap<_, tunnel::Secret> = secrets
        .into_iter()
        .map(|(id, value)| (id, value.into()))
        .collect();
    let snapshot = state.snapshot();
    let remember = remember_host_ids
        .unwrap_or_default()
        .into_iter()
        .collect::<std::collections::BTreeSet<_>>();
    let state = state.inner().clone();
    Ok(crate::batch::start(ids, |id| {
        let state = state.clone();
        let app = app.clone();
        let hosts = &snapshot.hosts;
        let rule = snapshot.rules.iter().find(|r| r.id == id).cloned();
        let secrets = &secrets;
        let remember = remember.clone();
        async move {
            if state
                .workers
                .lock()
                .await
                .get(&id)
                .is_some_and(|w| !w.join.is_finished())
            {
                return Ok(());
            }
            let rule = rule.ok_or(crate::native_message::plain("ruleMissing"))?;
            let target = hosts
                .iter()
                .find(|h| h.id == rule.host_id)
                .ok_or_else(|| crate::native_message::plain("hostMissing"))?
                .login(rule.login_identity_id.as_deref())?;
            let mut credentials = LoginCredentials::default();
            let mut route = resolve_jumps(hosts, &target)?;
            route.push(target.clone());
            for host in &route {
                let key = if identity_keys == Some(true) {
                    serde_json::to_string(&(
                        &host.id,
                        host.active_login_id
                            .clone()
                            .unwrap_or_else(|| primary_login_id(&host.id)),
                    ))
                    .map_err(|e| e.to_string())?
                } else if host.active_login_id.is_none() {
                    host.id.clone()
                } else {
                    continue;
                };
                if remember.contains(&key) {
                    credentials.remember.insert(host.id.clone());
                }
                if let Some(value) = secrets.get(&key) {
                    if host.id == target.id {
                        credentials.secret = value.clone();
                    } else {
                        credentials.jumps.insert(host.id.clone(), value.clone());
                    }
                }
            }
            launch_impl(state, app, rule, false, true, credentials, Some(route)).await
        }
    })
    .await)
}
#[tauri::command]
pub async fn stop_batch(
    state: tauri::State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    ids: Vec<String>,
) -> Result<Vec<BatchResult>, String> {
    let mut workers = state.workers.lock().await;
    let mut jobs = Vec::new();
    let mut seen = std::collections::BTreeSet::new();
    let mut results = Vec::new();
    let ids = ids
        .into_iter()
        .filter(|id| seen.insert(id.clone()))
        .collect::<Vec<_>>();
    for id in &ids {
        state.commands.cancel_for_rule(id);
        if let Some(worker) = workers.remove(id) {
            worker.cancel.cancel();
            jobs.push(worker);
        }
        state.trust.lock().unwrap().remove(id);
        results.push(BatchResult {
            id: id.clone(),
            accepted: true,
            error: None,
        });
    }
    for worker in jobs {
        let _ = worker.join.await;
    }
    state.settle_stopped(&ids);
    state.publish(&app);
    Ok(results)
}
#[tauri::command]
pub async fn export_config(
    state: tauri::State<'_, Arc<AppState>>,
    ids: Vec<String>,
    include_key_paths: bool,
    service_ids: Option<Vec<String>>,
    window: tauri::WebviewWindow,
) -> Result<Option<String>, String> {
    command_api::local(&window)?;
    let value = crate::config_export::package_with_services(
        &state.snapshot(),
        &ids,
        &service_ids.unwrap_or_default(),
        include_key_paths,
    )?;
    save_config_package(value).await
}

#[tauri::command]
pub fn preview_config_export(
    state: tauri::State<'_, Arc<AppState>>,
    selection: crate::config_export::WorkspaceSelection,
    window: tauri::WebviewWindow,
) -> Result<crate::config_export::WorkspacePreview, String> {
    command_api::local(&window)?;
    crate::config_export::workspace(&state.snapshot(), &selection).map(|(_, preview)| preview)
}

#[tauri::command]
pub async fn export_workspace_config(
    state: tauri::State<'_, Arc<AppState>>,
    selection: crate::config_export::WorkspaceSelection,
    fingerprint: String,
    window: tauri::WebviewWindow,
) -> Result<Option<String>, String> {
    command_api::local(&window)?;
    let value =
        crate::config_export::reviewed_workspace(&state.snapshot(), &selection, &fingerprint)?;
    save_config_package(value).await
}

async fn save_config_package(value: serde_json::Value) -> Result<Option<String>, String> {
    tokio::task::spawn_blocking(move || {
        let Some(path) = rfd::FileDialog::new()
            .set_title(crate::native_message::text(
                "saveConfigTitle",
                serde_json::json!({}),
            ))
            .add_filter("JSON", &["json"])
            .set_file_name("oria-ssh.json")
            .save_file()
        else {
            return Ok(None);
        };
        crate::config_export::write(&path, &value)?;
        Ok(Some(path.to_string_lossy().into_owned()))
    })
    .await
    .map_err(|_| crate::native_message::plain("exportDialogFailed"))?
}
#[tauri::command]
pub async fn pick_identity_file() -> Result<Option<String>, String> {
    tokio::task::spawn_blocking(|| {
        rfd::FileDialog::new()
            .set_title(crate::native_message::text(
                "pickIdentityTitle",
                serde_json::json!({}),
            ))
            .pick_file()
            .map(|path| path.to_string_lossy().into_owned())
    })
    .await
    .map_err(|_| crate::native_message::plain("pickIdentityFailed"))
}
#[tauri::command]
pub async fn pick_ssh_config_file() -> Result<Option<String>, String> {
    tokio::task::spawn_blocking(|| {
        rfd::FileDialog::new()
            .set_title(crate::native_message::text(
                "pickConfigTitle",
                serde_json::json!({}),
            ))
            .pick_file()
            .map(|path| path.to_string_lossy().into_owned())
    })
    .await
    .map_err(|_| crate::native_message::plain("pickConfigFailed"))
}
#[tauri::command]
pub fn set_autostart(
    state: tauri::State<Arc<AppState>>,
    app: tauri::AppHandle,
    enabled: bool,
) -> Result<Snapshot, String> {
    if !crate::long_running::AUTOSTART_SUPPORTED {
        return Err(crate::native_message::plain("autostartUnavailable"));
    }
    crate::long_running::set(enabled)?;
    let actual = crate::long_running::read();
    *state.autostart.lock().unwrap() = actual.clone();
    actual?;
    state.publish(&app);
    Ok(state.snapshot())
}
#[tauri::command]
pub async fn preview_import_file(
    state: tauri::State<'_, Arc<AppState>>,
    source: crate::config_import::ImportSource,
    window: tauri::WebviewWindow,
) -> Result<crate::config_import::Preview, String> {
    command_api::local(&window)?;
    *state.import.lock().unwrap() = None;
    let (bytes, name) = tokio::task::spawn_blocking(move || source.read())
        .await
        .map_err(|_| crate::native_message::plain("selectedConfigRead"))??;
    state.stage_import(&bytes, name)
}
#[tauri::command]
pub async fn commit_import(
    state: tauri::State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    token: String,
    choices: crate::config_import::Choices,
    window: tauri::WebviewWindow,
) -> Result<Snapshot, String> {
    command_api::local(&window)?;
    let _launch = state.workers.lock().await;
    state.allow_launch()?;
    state.apply_import(&token, &choices)?;
    state.publish(&app);
    Ok(state.snapshot())
}
#[tauri::command]
pub fn cancel_import(
    state: tauri::State<Arc<AppState>>,
    window: tauri::WebviewWindow,
) -> Result<(), String> {
    command_api::local(&window)?;
    *state.import.lock().unwrap() = None;
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bulk_delete_is_atomic_and_undo_restores_the_whole_selection_stopped() {
        let dir = tempfile::tempdir().unwrap();
        let state =
            AppState::load_with_discovery(dir.path().join("connections.json"), Default::default())
                .unwrap();
        state.config.lock().unwrap().rules = ["a", "b", "keep"]
            .into_iter()
            .map(|id| Rule {
                id: id.into(),
                auto_connect: true,
                ..Default::default()
            })
            .collect();
        assert!(state.remove_rules(&["a".into(), "missing".into()]).is_err());
        assert_eq!(state.snapshot().rules.len(), 3);
        assert_eq!(state.snapshot().forward_undo_count, 0);
        std::fs::create_dir(state.path.with_extension("tmp")).unwrap();
        assert!(state.remove_rules(&["a".into(), "b".into()]).is_err());
        assert_eq!(state.snapshot().rules.len(), 3);
        assert_eq!(state.snapshot().forward_undo_count, 0);
        std::fs::remove_dir(state.path.with_extension("tmp")).unwrap();
        state
            .remove_rules(&["a".into(), "b".into(), "a".into()])
            .unwrap();
        assert_eq!(state.snapshot().rules.len(), 1);
        assert_eq!(state.snapshot().rules[0].id, "keep");
        assert_eq!(state.snapshot().forward_undo_count, 1);
        state.config.lock().unwrap().rules.push(Rule {
            id: "a".into(),
            ..Default::default()
        });
        assert!(state.restore_deletion(DeletionKind::Forward).is_err());
        assert_eq!(state.snapshot().forward_undo_count, 1);
        state.config.lock().unwrap().rules.retain(|r| r.id != "a");
        state.restore_deletion(DeletionKind::Forward).unwrap();
        assert_eq!(state.snapshot().rules.len(), 3);
        assert!(state
            .snapshot()
            .rules
            .iter()
            .filter(|r| r.id != "keep")
            .all(|r| !r.auto_connect));
        assert!(
            state
                .snapshot()
                .rules
                .iter()
                .find(|r| r.id == "keep")
                .unwrap()
                .auto_connect
        );
        assert_eq!(state.snapshot().forward_undo_count, 0);
    }
    #[test]
    fn undo_histories_keep_cascades_and_individual_forward_deletions_separate() {
        let dir = tempfile::tempdir().unwrap();
        let state =
            AppState::load_with_discovery(dir.path().join("connections.json"), Default::default())
                .unwrap();
        let host = Host {
            id: "host".into(),
            ..Default::default()
        };
        {
            let mut config = state.config.lock().unwrap();
            config.hosts.push(host.clone());
            for id in ["individual", "cascade"] {
                config.rules.push(Rule {
                    id: id.into(),
                    host_id: host.id.clone(),
                    auto_connect: true,
                    ..Default::default()
                });
            }
        }
        state.remove_rule("individual").unwrap();
        state
            .remove_host(&host.id, &["cascade".into()], &[])
            .unwrap();
        assert_eq!(
            state.restore_deletion(DeletionKind::Forward).unwrap_err(),
            crate::native_message::plain("restoreForwardHostFirst")
        );
        let deleted = state.snapshot();
        assert_eq!(
            (deleted.host_undo_count, deleted.forward_undo_count),
            (1, 1)
        );
        assert!(deleted.rules.is_empty() && deleted.added_host_ids.is_empty());
        state.restore_deletion(DeletionKind::Host).unwrap();
        assert!(state.restore_deletion(DeletionKind::Host).is_err());
        let restored = state.snapshot();
        assert_eq!(
            (restored.host_undo_count, restored.forward_undo_count),
            (0, 1)
        );
        assert_eq!(restored.rules.len(), 1);
        assert_eq!(restored.rules[0].id, "cascade");
        state.restore_deletion(DeletionKind::Forward).unwrap();
        assert!(state.restore_deletion(DeletionKind::Forward).is_err());
        let restored = state.snapshot();
        assert_eq!(restored.rules.len(), 2);
        assert!(restored.rules.iter().all(|r| !r.auto_connect));
    }

    #[test]
    fn deleting_discovered_host_removes_owned_services_and_undo_restores_only_its_links() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("connections.json");
        let host_id = "ssh:fixture";
        let discovery = ssh_config::Discovery {
            hosts: vec![Host {
                id: host_id.into(),
                name: "Fixture alias".into(),
                source: "config".into(),
                ..Default::default()
            }],
            ..Default::default()
        };
        let state = AppState::load_with_discovery(path.clone(), discovery.clone()).unwrap();
        state.add_discovered_hosts(&[host_id.into()]).unwrap();
        {
            let mut config = state.config.lock().unwrap();
            config.hosts.push(Host {
                id: "keep".into(),
                source: "manual".into(),
                ..Default::default()
            });
            config
                .rules
                .extend(
                    [("cascade", host_id), ("keep-rule", "keep")].map(|(id, host_id)| Rule {
                        id: id.into(),
                        host_id: host_id.into(),
                        auto_connect: true,
                        ..Default::default()
                    }),
                );
            config.services = [
                ("direct", vec![host_id], vec![]),
                ("owned", vec![host_id], vec!["cascade"]),
                (
                    "shared",
                    vec![host_id, "keep"],
                    vec!["cascade", "keep-rule"],
                ),
                ("template", vec![], vec![]),
            ]
            .into_iter()
            .map(|(id, hosts, rules)| {
                serde_json::from_value(serde_json::json!({
                    "id": id, "name": id, "revision": "v1", "port": 80,
                    "hostIds": hosts, "ruleIds": rules, "noLocalEnvironment": true, "actions": [],
                }))
                .unwrap()
            })
            .collect();
            config.services[2]
                .login_by_host
                .insert(host_id.into(), primary_login_id(host_id));
            config.services[2]
                .login_by_host
                .insert("keep".into(), primary_login_id("keep"));
            state.persist(&config).unwrap();
        }
        let expected_rules = ["cascade".into()];
        let preview = || {
            let config = state.config.lock().unwrap();
            state
                .host_deletion_impact(&config, host_id, &state.deletion_hosts(&config))
                .unwrap()
        };
        let stale = preview();
        assert_eq!(
            stale
                .services
                .iter()
                .map(|s| (s.id.as_str(), s.remove))
                .collect::<Vec<_>>(),
            [("direct", true), ("owned", true), ("shared", false)]
        );
        state.config.lock().unwrap().services[2].revision = "v2".into();
        assert_eq!(
            state
                .remove_host(host_id, &expected_rules, &stale.services)
                .unwrap_err(),
            crate::native_message::plain("hostServicesChanged")
        );
        assert_eq!(state.snapshot().services.len(), 4);
        let expected = preview();
        std::fs::create_dir(path.with_extension("tmp")).unwrap();
        assert!(state
            .remove_host(host_id, &expected_rules, &expected.services)
            .is_err());
        assert_eq!(preview().services.len(), 3);
        assert_eq!(state.snapshot().host_undo_count, 0);
        std::fs::remove_dir(path.with_extension("tmp")).unwrap();
        state
            .remove_host(host_id, &expected_rules, &expected.services)
            .unwrap();

        let copied = dir.path().join("reopened.json");
        std::fs::copy(&path, &copied).unwrap();
        let reopened = AppState::load_with_discovery(copied, discovery).unwrap();
        reopened.add_discovered_hosts(&[host_id.into()]).unwrap();
        let snapshot = reopened.snapshot();
        assert!(snapshot.added_host_ids.iter().any(|id| id == host_id));
        assert_eq!(
            snapshot
                .services
                .iter()
                .map(|s| s.id.as_str())
                .collect::<Vec<_>>(),
            ["shared", "template"]
        );
        let shared = &snapshot.services[0];
        assert_eq!(shared.host_ids, ["keep"]);
        assert_eq!(shared.rule_ids, ["keep-rule"]);
        assert!(!shared.login_by_host.contains_key(host_id));
        assert_eq!(shared.login_by_host["keep"], primary_login_id("keep"));

        {
            let mut config = state.config.lock().unwrap();
            config.services[0].name = "Shared after edit".into();
            config.services[0].revision = "v3".into();
        }
        state.restore_deletion(DeletionKind::Host).unwrap();
        let snapshot = state.snapshot();
        assert_eq!(snapshot.services.len(), 4);
        let shared = &snapshot.services[0];
        assert_eq!(shared.name, "Shared after edit");
        assert_eq!(shared.revision, "v3");
        assert_eq!(shared.host_ids, ["keep", host_id]);
        assert_eq!(shared.rule_ids, ["keep-rule", "cascade"]);
        assert_eq!(shared.login_by_host[host_id], primary_login_id(host_id));
        let owned = snapshot
            .services
            .iter()
            .find(|service| service.id == "owned")
            .unwrap();
        assert_eq!(owned.rule_ids, ["cascade"]);
        assert_ne!(owned.revision, "v1");
        assert!(
            !snapshot
                .rules
                .iter()
                .find(|rule| rule.id == "cascade")
                .unwrap()
                .auto_connect
        );
    }

    #[test]
    fn forward_deletions_do_not_evict_or_restore_hosts() {
        let dir = tempfile::tempdir().unwrap();
        let state =
            AppState::load_with_discovery(dir.path().join("connections.json"), Default::default())
                .unwrap();
        state.config.lock().unwrap().hosts.push(Host {
            id: "host".into(),
            ..Default::default()
        });
        state.remove_host("host", &[], &[]).unwrap();
        for n in 0..21 {
            let id = format!("rule-{n}");
            state.config.lock().unwrap().rules.push(Rule {
                id: id.clone(),
                ..Default::default()
            });
            state.remove_rule(&id).unwrap();
        }
        let deleted = state.snapshot();
        assert_eq!(
            (deleted.host_undo_count, deleted.forward_undo_count),
            (1, 20)
        );
        state.restore_deletion(DeletionKind::Forward).unwrap();
        assert_eq!(state.snapshot().rules[0].id, "rule-20");
        assert!(state
            .snapshot()
            .added_host_ids
            .iter()
            .all(|id| id != "host"));
        state.restore_deletion(DeletionKind::Host).unwrap();
        let restored = state.snapshot();
        assert!(restored.added_host_ids.iter().any(|id| id == "host"));
        assert_eq!(
            (restored.host_undo_count, restored.forward_undo_count),
            (0, 19)
        );
    }

    #[tokio::test]
    async fn host_cascade_delete_checks_confirmation_and_cleans_only_related_sessions() {
        let dir = tempfile::tempdir().unwrap();
        let state =
            AppState::load_with_discovery(dir.path().join("connections.json"), Default::default())
                .unwrap();
        {
            let mut config = state.config.lock().unwrap();
            config.hosts = ["host", "keep"]
                .into_iter()
                .map(|id| Host {
                    id: id.into(),
                    name: id.into(),
                    source: "manual".into(),
                    ..Default::default()
                })
                .collect();
            config.rules = ["a", "b", "keep"]
                .into_iter()
                .map(|id| Rule {
                    id: id.into(),
                    host_id: if id == "keep" { "keep" } else { "host" }.into(),
                    auto_connect: true,
                    ..Default::default()
                })
                .collect();
        }
        assert!(state.remove_host("host", &["a".into()], &[]).is_err());
        assert_eq!(state.snapshot().rules.len(), 3);
        assert_eq!(state.snapshot().hosts.len(), 2);
        std::fs::create_dir(state.path.with_extension("tmp")).unwrap();
        assert!(state
            .remove_host("host", &["a".into(), "b".into()], &[])
            .is_err());
        assert_eq!(state.snapshot().host_undo_count, 0);
        std::fs::remove_dir(state.path.with_extension("tmp")).unwrap();
        let mut tokens = Vec::new();
        for id in ["a", "b", "host-test:host", "keep"] {
            let cancel = CancellationToken::new();
            let waiting = cancel.clone();
            tokens.push(cancel.clone());
            state.workers.lock().await.insert(
                id.into(),
                Worker {
                    rule: Rule::default(),
                    cancel,
                    join: tokio::spawn(async move {
                        waiting.cancelled().await;
                    }),
                },
            );
            state.runtimes.lock().unwrap().insert(
                id.into(),
                Runtime {
                    rule_id: id.into(),
                    status: "stopped".into(),
                    ..Default::default()
                },
            );
            state
                .generations
                .lock()
                .unwrap()
                .insert(id.into(), "run".into());
            let (reply, _receiver) = oneshot::channel();
            state.trust.lock().unwrap().insert(
                id.into(),
                PendingTrust {
                    run_id: "run".into(),
                    fingerprint: "fixture".into(),
                    endpoint: "fixture".into(),
                    reply,
                },
            );
        }
        let mut ids = state
            .remove_host("host", &["a".into(), "b".into()], &[])
            .unwrap();
        ids.push("host-test:host".into());
        {
            let mut workers = state.workers.lock().await;
            clear_deleted_sessions(&state, &mut workers, &ids).await;
            assert_eq!(workers.len(), 1);
            assert!(workers.contains_key("keep"));
        }
        assert!(tokens[..3].iter().all(CancellationToken::is_cancelled));
        assert!(!tokens[3].is_cancelled());
        assert_eq!(state.runtimes.lock().unwrap().len(), 1);
        assert_eq!(state.generations.lock().unwrap().len(), 1);
        assert_eq!(state.trust.lock().unwrap().len(), 1);
        assert_eq!(state.snapshot().rules.len(), 1);
        assert_eq!(state.snapshot().hosts.len(), 1);
        state.restore_deletion(DeletionKind::Host).unwrap();
        assert_eq!(state.snapshot().rules.len(), 3);
        assert_eq!(state.snapshot().hosts.len(), 2);
        assert!(state
            .snapshot()
            .rules
            .iter()
            .filter(|r| r.id != "keep")
            .all(|r| !r.auto_connect));
        assert_eq!(state.workers.lock().await.len(), 1);
        state.stop_all().await;
    }
    #[test]
    fn config_host_delete_and_undo_preserve_source_and_added_metadata() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("ssh_config");
        std::fs::write(&source, b"Host fixture\n HostName example.invalid\n").unwrap();
        let host = Host {
            id: "ssh:fixture".into(),
            source: "config".into(),
            ..Default::default()
        };
        let discovery = ssh_config::Discovery {
            hosts: vec![host.clone()],
            ..Default::default()
        };
        let state =
            AppState::load_with_discovery(dir.path().join("connections.json"), discovery).unwrap();
        {
            let mut config = state.config.lock().unwrap();
            config.host_metadata.insert(
                host.id.clone(),
                HostMetadata {
                    logins: vec![],
                    credential_ids: vec![],
                    default_login_id: None,
                    name: "Added".into(),
                    appearance: None,
                    tags: vec!["tag".into()],
                },
            );
            config.host_snapshots.insert(host.id.clone(), host.clone());
            config.rules.push(Rule {
                id: "forward".into(),
                host_id: host.id.clone(),
                auto_connect: true,
                ..Default::default()
            });
        }
        state
            .remove_host(&host.id, &["forward".into()], &[])
            .unwrap();
        assert!(state.snapshot().added_host_ids.is_empty());
        assert!(state.snapshot().rules.is_empty());
        assert!(state.config.lock().unwrap().host_metadata.is_empty());
        state.restore_deletion(DeletionKind::Host).unwrap();
        assert_eq!(state.snapshot().added_host_ids, vec![host.id.clone()]);
        assert_eq!(state.snapshot().hosts[0].name, "Added");
        assert!(!state.snapshot().rules[0].auto_connect);
        assert_eq!(
            std::fs::read(&source).unwrap(),
            b"Host fixture\n HostName example.invalid\n"
        );
    }
    #[test]
    fn added_config_hosts_persist_without_promoting_all_discovered_candidates() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("connections.json");
        let candidate = Host {
            id: "ssh:candidate".into(),
            name: "Candidate".into(),
            source: "config".into(),
            ..Default::default()
        };
        let jump = Host {
            id: "ssh:jump".into(),
            name: "Jump".into(),
            source: "config".into(),
            ..Default::default()
        };
        let discovery = ssh_config::Discovery {
            hosts: vec![candidate.clone(), jump],
            ..Default::default()
        };
        let state = AppState::load_with_discovery(path.clone(), discovery.clone()).unwrap();
        assert_eq!(state.snapshot().hosts.len(), 2);
        assert!(state.snapshot().added_host_ids.is_empty());
        {
            let mut config = state.config.lock().unwrap();
            config.host_metadata.insert(
                candidate.id.clone(),
                HostMetadata {
                    logins: vec![],
                    credential_ids: vec![],
                    default_login_id: None,
                    name: candidate.name.clone(),
                    appearance: None,
                    tags: vec![],
                },
            );
            config
                .host_snapshots
                .insert(candidate.id.clone(), candidate.clone());
            state.persist(&config).unwrap();
        }
        assert_eq!(state.snapshot().added_host_ids, vec!["ssh:candidate"]);
        let restored = AppState::load_with_discovery(path, discovery).unwrap();
        assert_eq!(restored.snapshot().added_host_ids, vec!["ssh:candidate"]);
        assert!(restored.snapshot().runtimes.is_empty());
        assert!(restored.workers.try_lock().unwrap().is_empty());
        let missing =
            AppState::load_with_discovery(restored.path.clone(), Default::default()).unwrap();
        assert_eq!(missing.snapshot().hosts.len(), 1);
        assert_eq!(missing.snapshot().hosts[0].id, "ssh:candidate");
        assert!(!missing.snapshot().hosts[0].diagnostics.is_empty());
    }
    #[test]
    fn discovered_multi_add_is_atomic_persistent_and_never_creates_rules_or_connections() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("connections.json");
        let discovery = ssh_config::Discovery {
            hosts: ["first", "second", "untouched"]
                .into_iter()
                .map(|name| Host {
                    id: format!("ssh:{name}"),
                    name: name.into(),
                    source: "config".into(),
                    ..Default::default()
                })
                .collect(),
            ..Default::default()
        };
        let state = AppState::load_with_discovery(path.clone(), discovery.clone()).unwrap();
        assert!(state.add_discovered_hosts(&[]).is_err());
        assert!(state
            .add_discovered_hosts(&["ssh:first".into(), "missing".into()])
            .is_err());
        assert!(state.snapshot().added_host_ids.is_empty());
        assert!(!path.exists());
        state
            .add_discovered_hosts(&["ssh:first".into(), "ssh:second".into(), "ssh:first".into()])
            .unwrap();
        assert_eq!(state.snapshot().added_host_ids, ["ssh:first", "ssh:second"]);
        let saved = std::fs::read(&path).unwrap();
        let restored = AppState::load_with_discovery(path.clone(), discovery).unwrap();
        assert_eq!(
            restored.snapshot().added_host_ids,
            ["ssh:first", "ssh:second"]
        );
        assert!(restored.snapshot().rules.is_empty());
        assert!(restored.snapshot().runtimes.is_empty());
        assert!(restored.add_discovered_hosts(&["missing".into()]).is_err());
        assert_eq!(std::fs::read(&path).unwrap(), saved);
        // A failed write also leaves the in-memory selection unchanged.
        std::fs::remove_file(&path).unwrap();
        std::fs::create_dir(&path).unwrap();
        assert!(restored
            .add_discovered_hosts(&["ssh:untouched".into()])
            .is_err());
        assert_eq!(
            restored.snapshot().added_host_ids,
            ["ssh:first", "ssh:second"]
        );
    }
    #[test]
    fn workspace_import_commits_shared_login_and_hosts_together_and_survives_reload() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("connections.json");
        let state = AppState::load_with_discovery(path.clone(), Default::default()).unwrap();
        let login_id = uuid::Uuid::new_v4().to_string();
        let login = LoginIdentity {
            id: login_id.clone(),
            label: "Dedicated fixture".into(),
            user: "fixture account".into(),
            auth_method: AuthMethod::Agent,
            identity_files: vec![],
        };
        let ids = vec!["first".to_string(), "second".to_string()];
        let hosts = ids
            .iter()
            .map(|id| Host {
                id: id.clone(),
                name: id.clone(),
                address: format!("{id}.invalid"),
                port: 22,
                user: login.user.clone(),
                auth_method: login.auth_method.clone(),
                credential_only: true,
                credential_ids: vec![login_id.clone()],
                default_login_id: Some(login_id.clone()),
                logins: vec![login.clone()],
                source: "manual".into(),
                ..Default::default()
            })
            .collect();
        let snapshot = Snapshot {
            hosts,
            login_credentials: vec![login],
            added_host_ids: ids.clone(),
            ..Default::default()
        };
        let scope = crate::config_export::WorkspaceSelection {
            host_ids: ids.clone(),
            rule_ids: vec![],
            service_ids: vec![],
            include_service_commands: false,
        };
        let (document, _) = crate::config_export::workspace(&snapshot, &scope).unwrap();
        let preview = state
            .stage_import(document.to_string().as_bytes(), "workspace.json".into())
            .unwrap();
        let choices = crate::config_import::Choices {
            host_ids: ids,
            ..Default::default()
        };
        let blocked_write = path.with_extension("tmp");
        std::fs::create_dir(&blocked_write).unwrap();
        assert!(state.apply_import(&preview.token, &choices).is_err());
        assert!(state.snapshot().hosts.is_empty());
        assert!(state.snapshot().login_credentials.is_empty());
        std::fs::remove_dir(blocked_write).unwrap();
        state.apply_import(&preview.token, &choices).unwrap();
        assert!(state.apply_import(&preview.token, &choices).is_err());
        drop(state);

        let reloaded = AppState::load_with_discovery(path, Default::default())
            .unwrap()
            .snapshot();
        assert_eq!(reloaded.hosts.len(), 2);
        assert_eq!(reloaded.login_credentials.len(), 1);
        let migrated = &reloaded.login_credentials[0];
        assert_ne!(migrated.id, login_id);
        for host in &reloaded.hosts {
            assert_eq!(host.credential_ids, vec![migrated.id.clone()]);
            assert_eq!(host.logins, vec![migrated.clone()]);
            assert_eq!(host.default_login().unwrap().user, "fixture account");
        }
        assert!(reloaded.runtimes.is_empty());
    }

    #[test]
    fn import_is_atomic_stopped_additive_single_use_and_rejects_changed_preview() {
        let dir = tempfile::tempdir().unwrap();
        let state =
            AppState::load_with_discovery(dir.path().join("connections.json"), Default::default())
                .unwrap();
        let existing = Host {
            id: "host".into(),
            name: "Host".into(),
            address: "127.0.0.1".into(),
            port: 22,
            user: "tester".into(),
            ..Default::default()
        };
        let rule = Rule {
            id: "rule".into(),
            name: "Forward".into(),
            host_id: "host".into(),
            bind_port: 1234,
            target_host: "localhost".into(),
            target_port: 80,
            auto_connect: true,
            ..Default::default()
        };
        state.config.lock().unwrap().hosts.push(existing);
        state.config.lock().unwrap().rules.push(rule);
        let value =
            crate::config_export::package(&state.snapshot(), &["rule".into()], false).unwrap();
        let bytes = serde_json::to_vec(&value).unwrap();
        let preview = state.stage_import(&bytes, "fixture.json".into()).unwrap();
        let choices = crate::config_import::Choices {
            rule_ids: vec!["rule".into()],
            ..Default::default()
        };
        assert_eq!(state.snapshot().rules.len(), 1);
        std::fs::create_dir(state.path.with_extension("tmp")).unwrap();
        assert!(state.apply_import(&preview.token, &choices).is_err());
        assert_eq!(state.snapshot().rules.len(), 1);
        assert!(state.import.lock().unwrap().is_some());
        std::fs::remove_dir(state.path.with_extension("tmp")).unwrap();
        state.apply_import(&preview.token, &choices).unwrap();
        let snapshot = state.snapshot();
        assert_eq!(snapshot.rules.len(), 2);
        assert_eq!(snapshot.hosts.len(), 2);
        assert!(snapshot.rules[0].auto_connect);
        assert!(!snapshot.rules[1].auto_connect);
        assert!(snapshot.runtimes.is_empty());
        assert!(state.workers.try_lock().unwrap().is_empty());
        assert!(snapshot.rules[0].id != snapshot.rules[1].id);
        assert_eq!(snapshot.rules[1].name, "Forward (2)");
        assert_eq!(snapshot.hosts[1].name, "Host (2)");
        assert!(state.apply_import(&preview.token, &choices).is_err());
        let preview = state.stage_import(&bytes, "fixture.json".into()).unwrap();
        state.config.lock().unwrap().close_to_tray = false;
        assert!(state.apply_import(&preview.token, &choices).is_err());
        assert_eq!(state.snapshot().rules.len(), 2);
        let restored =
            AppState::load_with_discovery(state.path.clone(), Default::default()).unwrap();
        assert_eq!(restored.snapshot().rules.len(), 2);
        assert!(restored.snapshot().runtimes.is_empty());
    }
    #[test]
    fn shared_credentials_persist_and_forwards_follow_the_current_host_credential() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("connections.json");
        let state = AppState::isolated(path.clone());
        let mut shared = LoginIdentity {
            id: uuid::Uuid::new_v4().to_string(),
            label: String::new(),
            user: "fixture-user".into(),
            auth_method: AuthMethod::PrivateKey,
            identity_files: vec!["/fixture/key".into()],
        };
        let other = LoginIdentity {
            id: uuid::Uuid::new_v4().to_string(),
            label: "Deployment".into(),
            user: "fixture-deploy".into(),
            auth_method: AuthMethod::Agent,
            identity_files: vec![],
        };
        state
            .save_login_credential(shared.clone(), None, false)
            .unwrap();
        state
            .save_login_credential(other.clone(), None, false)
            .unwrap();
        let mut first = Host {
            id: "first".into(),
            name: "First fixture".into(),
            address: "127.0.0.1".into(),
            port: 22,
            credential_only: true,
            credential_ids: vec![shared.id.clone(), other.id.clone()],
            default_login_id: Some(shared.id.clone()),
            ..Default::default()
        };
        state.upsert_host(first.clone(), None).unwrap();
        state
            .upsert_host(
                Host {
                    id: "second".into(),
                    name: "Second fixture".into(),
                    credential_ids: vec![shared.id.clone()],
                    ..first.clone()
                },
                None,
            )
            .unwrap();
        save_rule_profile(
            &state,
            Rule {
                id: "forward".into(),
                name: "Fixture forward".into(),
                host_id: first.id.clone(),
                target_host: "127.0.0.1".into(),
                target_port: 80,
                ..Default::default()
            },
            None,
        )
        .unwrap();
        first.default_login_id = Some(other.id.clone());
        state.upsert_host(first.clone(), None).unwrap();
        first.credential_ids = vec![other.id.clone()];
        state.upsert_host(first, None).unwrap();
        assert!(state.delete_login_credential(&shared.id).is_err());

        shared.label = "Maintenance".into();
        shared.user = "Build Operator".into();
        state
            .save_login_credential(shared.clone(), None, false)
            .unwrap();
        let reopened = AppState::isolated(path);
        let snapshot = reopened.snapshot();
        let first = snapshot
            .hosts
            .iter()
            .find(|host| host.id == "first")
            .unwrap();
        let second = snapshot
            .hosts
            .iter()
            .find(|host| host.id == "second")
            .unwrap();
        assert_eq!(first.login(None).unwrap().login_id(), other.id);
        assert_eq!(second.login_id(), shared.id);
        assert_eq!(second.user, shared.user);
        let rule = &snapshot.rules[0];
        assert_eq!(rule.login_identity_id.as_ref(), Some(&other.id));
        assert_eq!(
            first.login(rule.login_identity_id.as_deref()).unwrap().user,
            other.user
        );
        assert_eq!(
            snapshot
                .login_credentials
                .iter()
                .find(|login| login.id == shared.id),
            Some(&shared)
        );
        let config = reopened.config.lock().unwrap();
        assert!(config
            .hosts
            .iter()
            .all(|host| host.user.is_empty() && host.logins.is_empty()));
        drop(config);
        let package = crate::config_export::package(&snapshot, &["forward".into()], false).unwrap();
        assert_eq!(
            package["hosts"][0]["logins"][0]["identityFiles"],
            serde_json::json!([])
        );
        assert!(reopened
            .stage_import(
                &serde_json::to_vec(&package).unwrap(),
                "fixture.json".into()
            )
            .is_ok());
    }

    #[test]
    fn reloading_uses_the_current_login_and_preserves_forward_port_policy() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("connections.json");
        let state = AppState::isolated(path.clone());
        let login = uuid::Uuid::new_v4().to_string();
        let mut host = Host {
            id: "lab".into(),
            user: "alice".into(),
            name: "fixture".into(),
            address: "127.0.0.1".into(),
            port: 22,
            logins: vec![LoginIdentity {
                id: login.clone(),
                label: "Deploy".into(),
                user: "Deploy Operator".into(),
                auth_method: AuthMethod::Agent,
                identity_files: vec![],
            }],
            ..Default::default()
        };
        state.upsert_host(host.clone(), None).unwrap();
        for (kind, id) in [
            (ForwardKind::L, "local"),
            (ForwardKind::D, "proxy"),
            (ForwardKind::R, "remote"),
        ] {
            let remote = kind == ForwardKind::R;
            let rule = Rule {
                id: id.into(),
                name: id.into(),
                host_id: host.id.clone(),
                login_identity_id: remote.then(|| login.clone()),
                bind_port: if remote { 8080 } else { 0 },
                kind,
                target_host: "127.0.0.1".into(),
                target_port: 8888,
                auto_connect: true,
                ..Default::default()
            };
            save_rule_profile(&state, rule, None).unwrap();
        }
        host.default_login_id = Some(login.clone());
        state.upsert_host(host, None).unwrap();
        drop(state);
        let snapshot = AppState::isolated(path).snapshot();
        let host = &snapshot.hosts[0];
        assert_eq!(host.default_login_id.as_ref(), Some(&login));
        assert!(snapshot.runtimes.is_empty());
        for rule in snapshot.rules {
            let remote = rule.kind == ForwardKind::R;
            assert!(rule.auto_connect);
            assert_eq!(rule.bind_port, if remote { 8080 } else { 0 });
            assert_eq!(
                host.login(rule.login_identity_id.as_deref()).unwrap().user,
                "Deploy Operator"
            );
        }
    }

    #[test]
    fn forward_switch_changes_the_next_start_without_relabeling_the_live_connection() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("connections.json");
        let state = AppState::isolated(path.clone());
        let alternate = uuid::Uuid::new_v4().to_string();
        let mut host = Host {
            id: "lab".into(),
            name: "Lab".into(),
            address: "127.0.0.1".into(),
            port: 22,
            user: "alice".into(),
            logins: vec![LoginIdentity {
                id: alternate.clone(),
                label: "Deploy".into(),
                user: "deploy".into(),
                auth_method: AuthMethod::Agent,
                identity_files: vec![],
            }],
            ..Default::default()
        };
        let original = primary_login_id(&host.id);
        state.upsert_host(host.clone(), None).unwrap();
        let rule = Rule {
            id: "legacy".into(),
            name: "Legacy".into(),
            host_id: host.id.clone(),
            login_identity_id: Some(original.clone()),
            target_host: "127.0.0.1".into(),
            target_port: 8888,
            ..Default::default()
        };
        save_rule_profile(&state, rule.clone(), None).unwrap();
        state.runtimes.lock().unwrap().insert(
            rule.id.clone(),
            Runtime {
                rule_id: rule.id.clone(),
                status: "listening".into(),
                host_snapshot: Some(host.login(Some(&original)).unwrap()),
                ..Default::default()
            },
        );
        state
            .runtime_rules
            .lock()
            .unwrap()
            .insert(rule.id.clone(), rule);

        host.default_login_id = Some(alternate.clone());
        state.upsert_host(host, None).unwrap();
        let snapshot = state.snapshot();
        assert_eq!(
            snapshot.rules[0].login_identity_id.as_ref(),
            Some(&alternate)
        );
        let active = &snapshot.runtimes[0];
        assert_eq!(active.host_snapshot.as_ref().unwrap().user, "alice");
        assert!(active.configuration_changed);
    }

    #[cfg(any(windows, target_os = "macos"))]
    #[test]
    fn host_password_edit_saves_only_the_selected_login_and_keeps_config_secret_free() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("connections.json");
        let state = AppState::isolated(path.clone());
        let login_id = uuid::Uuid::new_v4().to_string();
        let mut host = Host {
            id: "fixture".into(),
            name: "Fixture".into(),
            address: "127.0.0.1".into(),
            port: 22,
            user: "Fixture Owner".into(),
            logins: vec![LoginIdentity {
                id: login_id.clone(),
                label: String::new(),
                user: "Deploy Operator".into(),
                auth_method: AuthMethod::Password,
                identity_files: vec![],
            }],
            ..Default::default()
        };
        let selected = host.login(Some(&login_id)).unwrap();
        let entry = state.vault.primary(&selected);
        struct Cleanup<'a>(crate::credentials::LoginPassword<'a>);
        impl Drop for Cleanup<'_> {
            fn drop(&mut self) {
                let _ = self.0.forget();
            }
        }
        let _cleanup = Cleanup(state.vault.primary(&selected));
        let secret = zeroize::Zeroizing::new(uuid::Uuid::new_v4().to_string());
        let password_edit = |password: Option<String>, clear_password| HostPasswordEdit {
            login_id: login_id.clone(),
            password,
            clear_password,
        };
        state.upsert_host(host.clone(), None).unwrap();
        assert!(entry.read().unwrap().is_none());
        state
            .upsert_host(
                host.clone(),
                Some(password_edit(Some(secret.to_string()), false)),
            )
            .unwrap();
        assert!(state.vault.primary(&host).read().unwrap().is_none());
        assert!(!std::fs::read_to_string(&path)
            .unwrap()
            .contains(secret.as_str()));
        host.name = "Renamed fixture".into();
        state.upsert_host(host.clone(), None).unwrap();
        assert!(entry
            .read()
            .unwrap()
            .is_some_and(|saved| *saved == **secret));
        std::fs::create_dir(path.with_extension("tmp")).unwrap();
        assert!(state
            .upsert_host(host.clone(), Some(password_edit(None, true)))
            .is_err());
        assert!(entry
            .read()
            .unwrap()
            .is_some_and(|saved| *saved == **secret));
        std::fs::remove_dir(path.with_extension("tmp")).unwrap();
        state
            .upsert_host(host, Some(password_edit(None, true)))
            .unwrap();
        assert!(entry.read().unwrap().is_none());
    }

    #[test]
    fn undo_restores_stopped_configuration_and_failed_writes_preserve_tombstone() {
        let dir = tempfile::tempdir().unwrap();
        let state =
            AppState::load_with_discovery(dir.path().join("connections.json"), Default::default())
                .unwrap();
        let rule = Rule {
            id: "fixture".into(),
            name: "fixture".into(),
            auto_connect: true,
            ..Default::default()
        };
        state.config.lock().unwrap().rules.push(rule.clone());
        state.remove_rule(&rule.id).unwrap();
        assert!(state.snapshot().rules.is_empty());
        assert_eq!(state.snapshot().forward_undo_count, 1);
        // Force an atomic-save failure with a directory at the temp path.
        std::fs::create_dir(state.path.with_extension("tmp")).unwrap();
        assert!(state.restore_deletion(DeletionKind::Forward).is_err());
        assert!(state.snapshot().rules.is_empty());
        assert_eq!(state.snapshot().forward_undo_count, 1);
        std::fs::remove_dir(state.path.with_extension("tmp")).unwrap();
        state.restore_deletion(DeletionKind::Forward).unwrap();
        let restored = state.snapshot();
        assert_eq!(restored.rules.len(), 1);
        assert_eq!(restored.rules[0].id, rule.id);
        assert!(!restored.rules[0].auto_connect);
        assert_eq!(restored.forward_undo_count, 0);
        assert!(restored.runtimes.is_empty());
        assert!(state.workers.try_lock().unwrap().is_empty());
        let reloaded =
            AppState::load_with_discovery(state.path.clone(), Default::default()).unwrap();
        assert_eq!(reloaded.snapshot().rules.len(), 1);
        assert!(reloaded.snapshot().runtimes.is_empty());
    }
    #[test]
    fn rule_changes_remain_visible_after_supervisor_metrics_replace_the_runtime() {
        let dir = tempfile::tempdir().unwrap();
        let state = AppState::isolated(dir.path().join("connections.json"));
        let rule = Rule {
            id: "fixture".into(),
            target_port: 3000,
            ..Default::default()
        };
        state.config.lock().unwrap().rules.push(rule.clone());
        state
            .runtime_rules
            .lock()
            .unwrap()
            .insert(rule.id.clone(), rule.clone());
        state.config.lock().unwrap().rules[0].target_port = 3689;
        for sent in [0, 100] {
            state.runtimes.lock().unwrap().insert(
                rule.id.clone(),
                Runtime {
                    rule_id: rule.id.clone(),
                    status: "listening".into(),
                    sent,
                    ..Default::default()
                },
            );
            assert!(state.snapshot().runtimes[0].configuration_changed);
        }
        state.runtime_rules.lock().unwrap().insert(
            rule.id.clone(),
            state.config.lock().unwrap().rules[0].clone(),
        );
        assert!(!state.snapshot().runtimes[0].configuration_changed);
    }
    #[test]
    fn explicit_stop_clears_terminal_attention_without_inventing_rate_samples() {
        let dir = tempfile::tempdir().unwrap();
        let state =
            AppState::load_with_discovery(dir.path().join("connections.json"), Default::default())
                .unwrap();
        state.runtimes.lock().unwrap().insert(
            "fixture".into(),
            Runtime {
                rule_id: "fixture".into(),
                status: "needs-attention".into(),
                message: "needs manual authentication".into(),
                error_kind: Some(FailureKind::Authentication),
                ..Default::default()
            },
        );
        state.settle_stopped(&["fixture".into()]);
        let r = state.snapshot().runtimes.pop().unwrap();
        assert_eq!(r.status, "stopped");
        assert!(!r.desired_running);
        assert!(r.message.is_empty());
        assert!(r.error_kind.is_none());
        assert!(r.sent_per_second.is_none());
    }
    #[tokio::test]
    async fn update_preparation_waits_for_sessions_and_blocks_launch_until_released() {
        let dir = tempfile::tempdir().unwrap();
        let state = Arc::new(
            AppState::load_with_discovery(dir.path().join("connections.json"), Default::default())
                .unwrap(),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let listener = Arc::new(listener);
        let worker_listener = Arc::downgrade(&listener);
        let token = CancellationToken::new();
        let cancelled = token.clone();
        let finish = Arc::new(tokio::sync::Notify::new());
        let finish_worker = finish.clone();
        state.workers.lock().await.insert(
            "forward".into(),
            Worker {
                rule: Rule::default(),
                cancel: token.clone(),
                join: tokio::spawn(async move {
                    cancelled.cancelled().await;
                    finish_worker.notified().await;
                    drop(listener);
                }),
            },
        );
        let preparing = {
            let state = state.clone();
            tokio::spawn(async move { state.prepare_update(&["forward".into()]).await })
        };
        token.cancelled().await;
        assert!(state.update_installing());
        assert_eq!(state.allow_launch().unwrap_err(), "updateInstalling");
        assert!(!preparing.is_finished());
        assert!(worker_listener.upgrade().is_some());
        finish.notify_one();
        preparing.await.unwrap().unwrap();
        assert!(worker_listener.upgrade().is_none());
        assert!(state.active_work_ids().await.is_empty());
        state.finish_update_attempt();
        assert!(state.allow_launch().is_ok());
        state.shutdown().await;
        state.finish_update_attempt();
        assert!(state.allow_launch().is_err());
    }
    #[tokio::test]
    async fn update_confirmation_changes_preserve_existing_sessions() {
        let dir = tempfile::tempdir().unwrap();
        let state =
            AppState::load_with_discovery(dir.path().join("connections.json"), Default::default())
                .unwrap();
        let token = CancellationToken::new();
        let worker = token.clone();
        state.workers.lock().await.insert(
            "host-test:fixture".into(),
            Worker {
                rule: Rule::default(),
                cancel: token.clone(),
                join: tokio::spawn(async move {
                    worker.cancelled().await;
                }),
            },
        );
        assert_eq!(
            state.prepare_update(&[]).await.unwrap_err(),
            "activityChanged"
        );
        assert!(!token.is_cancelled());
        state.finish_update_attempt();
        assert!(state.allow_launch().is_ok());
        state
            .prepare_update(&["host-test:fixture".into()])
            .await
            .unwrap();
        assert!(token.is_cancelled());
        state.finish_update_attempt();
    }
    #[tokio::test]
    async fn update_cleanup_failure_is_reported_and_does_not_set_permanent_shutdown() {
        let dir = tempfile::tempdir().unwrap();
        let state =
            AppState::load_with_discovery(dir.path().join("connections.json"), Default::default())
                .unwrap();
        let worker = tokio::spawn(async {
            panic!("isolated worker failure");
        });
        while !worker.is_finished() {
            tokio::task::yield_now().await;
        }
        state.workers.lock().await.insert(
            "failed".into(),
            Worker {
                rule: Rule::default(),
                cancel: CancellationToken::new(),
                join: worker,
            },
        );
        assert_eq!(state.prepare_update(&[]).await.unwrap_err(), "cleanup");
        state.finish_update_attempt();
        assert!(state.allow_launch().is_ok());
        assert!(state.workers.lock().await.is_empty());
    }
    #[tokio::test]
    async fn hiding_keeps_all_forwards_and_cancels_host_tests_then_exit_cancels_all() {
        let dir = tempfile::tempdir().unwrap();
        let state =
            AppState::load_with_discovery(dir.path().join("connections.json"), Default::default())
                .unwrap();
        {
            let mut c = state.config.lock().unwrap();
            c.rules = vec![
                Rule {
                    id: "background".into(),
                    background: true,
                    ..Default::default()
                },
                Rule {
                    id: "foreground".into(),
                    background: false,
                    ..Default::default()
                },
            ];
        }
        let mut tokens = Vec::new();
        for id in ["background", "foreground", "host-test:fixture"] {
            let token = CancellationToken::new();
            tokens.push(token.clone());
            let c = token.clone();
            state.workers.lock().await.insert(
                id.into(),
                Worker {
                    rule: Rule::default(),
                    cancel: token,
                    join: tokio::spawn(async move {
                        c.cancelled().await;
                    }),
                },
            );
        }
        state.cancel_host_tests_on_hide().await;
        assert!(!tokens[0].is_cancelled());
        assert!(!tokens[1].is_cancelled());
        assert!(tokens[2].is_cancelled());
        assert_eq!(state.workers.lock().await.len(), 2);
        state.shutdown().await;
        assert!(tokens[0].is_cancelled());
        assert!(tokens[1].is_cancelled());
        assert!(state.workers.lock().await.is_empty());
        assert!(state
            .shutting_down
            .load(std::sync::atomic::Ordering::SeqCst));
    }
    #[test]
    fn source_changes_preserve_rules_and_distinguish_unreadable_from_deleted() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("connections.json");
        let old = Host {
            id: "ssh:test".into(),
            address: "127.0.0.1".into(),
            ..Default::default()
        };
        let state = AppState::load_with_discovery(
            path.clone(),
            ssh_config::Discovery {
                hosts: vec![old.clone()],
                diagnostics: vec![],
            },
        )
        .unwrap();
        {
            let mut c = state.config.lock().unwrap();
            c.rules.push(Rule {
                id: "r".into(),
                host_id: old.id.clone(),
                ..Default::default()
            });
        }
        let mut new = old.clone();
        new.port = 2222;
        state
            .reconcile_hosts(ssh_config::Discovery {
                hosts: vec![new.clone()],
                diagnostics: vec![],
            })
            .unwrap();
        assert_eq!(state.snapshot().hosts[0].port, 2222);
        state
            .reconcile_hosts(ssh_config::Discovery {
                hosts: vec![],
                diagnostics: vec!["permission denied".into()],
            })
            .unwrap();
        let failed = state.snapshot();
        assert_eq!(failed.hosts[0].port, 2222);
        assert!(failed.hosts[0].diagnostics[0].contains("同步失败"));
        assert!(!state
            .reconcile_hosts(ssh_config::Discovery {
                hosts: vec![],
                diagnostics: vec!["permission denied".into()]
            })
            .unwrap());
        state.reconcile_hosts(Default::default()).unwrap();
        let missing = state.snapshot();
        assert_eq!(missing.rules.len(), 1);
        assert_eq!(missing.hosts[0].port, 2222);
        assert!(missing.hosts[0].diagnostics[0].contains("来源已失效"));
        let restarted = AppState::load_with_discovery(path, Default::default())
            .unwrap()
            .snapshot();
        assert_eq!(restarted.rules.len(), 1);
        assert_eq!(restarted.hosts[0].port, 2222);
        assert!(restarted.runtimes.is_empty());
    }
    #[test]
    fn legacy_rule_logins_preserve_aliases_and_back_up_once_before_write() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("connections.json");
        let backup = path.with_extension("pre-c006.json");
        let mut config = Config::default();
        for (alias, jump) in [("ssh:a", "jump-a"), ("ssh:b", "jump-b")] {
            let host = Host {
                id: alias.into(),
                address: "lab.invalid".into(),
                port: 22,
                user: "same-user".into(),
                proxy_jump: Some(jump.into()),
                ..Default::default()
            };
            config.host_snapshots.insert(alias.into(), host);
            config.rules.push(Rule {
                id: format!("forward-{alias}"),
                host_id: alias.into(),
                bind_port: 1234,
                target_host: "db.internal".into(),
                target_port: 5432,
                ..Default::default()
            });
        }
        let original = serde_json::to_vec(&config).unwrap();
        std::fs::write(&path, &original).unwrap();
        let state = AppState::load_with_discovery(path.clone(), Default::default()).unwrap();
        let next = state.config.lock().unwrap();
        assert_eq!(
            next.rules[0].login_identity_id.as_deref(),
            Some("primary:ssh:a")
        );
        assert_eq!(
            next.rules[1].login_identity_id.as_deref(),
            Some("primary:ssh:b")
        );
        for (before, after) in config.rules.iter().zip(&next.rules) {
            assert!(before.same_connection(after));
        }
        std::fs::create_dir(&backup).unwrap();
        assert!(state.persist(&next).is_err());
        assert_eq!(std::fs::read(&path).unwrap(), original);
        std::fs::remove_dir(&backup).unwrap();
        state.persist(&next).unwrap();
        let reopened = AppState::load_with_discovery(path, Default::default()).unwrap();
        let loaded = reopened.config.lock().unwrap();
        assert_eq!(loaded.rules, next.rules);
        assert_eq!(loaded.host_snapshots, config.host_snapshots);
        reopened.persist(&loaded).unwrap();
        assert_eq!(std::fs::read(backup).unwrap(), original);
    }

    #[test]
    fn manual_host_save_edit_reload_and_source_protection() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("profile/connections.json");
        let state = AppState::load_with_discovery(path.clone(), Default::default()).unwrap();
        let mut host = Host {
            name: "Manual".into(),
            address: "127.0.0.1".into(),
            port: 22,
            user: "tester".into(),
            ..Default::default()
        };
        state.upsert_host(host.clone(), None).unwrap();
        let saved = state.snapshot().hosts.remove(0);
        assert!(!saved.id.is_empty());
        assert_eq!(saved.source, "manual");
        host = saved.clone();
        host.name = "Updated".into();
        host.appearance = Some(HostAppearance {
            color: Some("#674122".into()),
            icon: Some(RuleIcon::Builtin("database".into())),
        });
        assert!(host.same_connection(&saved));
        state.upsert_host(host.clone(), None).unwrap();
        let reopened = AppState::load_with_discovery(path.clone(), Default::default()).unwrap();
        assert_eq!(reopened.snapshot().hosts.len(), 1);
        assert_eq!(reopened.snapshot().hosts[0].name, "Updated");
        assert_eq!(reopened.snapshot().hosts[0].appearance, host.appearance);
        let mut invalid = host.clone();
        invalid.appearance.as_mut().unwrap().color = Some("invalid".into());
        assert!(state.upsert_host(invalid, None).is_err());
        assert_eq!(state.snapshot().hosts[0].appearance, host.appearance);
        assert!(reopened.snapshot().runtimes.is_empty());
        host.id = "ssh:protected".into();
        assert!(state.upsert_host(host, None).is_err());
        std::fs::write(&path, b"invalid config").unwrap();
        assert!(AppState::load_with_discovery(path.clone(), Default::default()).is_err());
        assert_eq!(std::fs::read(path).unwrap(), b"invalid config");
    }
}
