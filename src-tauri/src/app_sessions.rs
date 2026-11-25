//! Shared credential and trust adaptation for user-initiated SSH sessions.
use super::*;
pub(super) type Active = Arc<dyn Fn() -> bool + Send + Sync>;
pub(super) type TrustChanged = Arc<dyn Fn(String, String) + Send + Sync>;

pub(super) fn default_login(host: &Host, expected: Option<&str>) -> Result<Host, String> {
    let login = host.default_login()?;
    if expected.is_some_and(|id| id != login.login_id()) {
        return Err(crate::native_message::plain("loginIdentityMissing"));
    }
    Ok(login)
}

pub(super) fn credentials(
    state: Arc<AppState>,
    app: tauri::AppHandle,
    route: &[Host],
    secrets: &BTreeMap<String, String>,
    remember: &[String],
    active: Active,
) -> Result<(Vec<tunnel::HopRequest>, tunnel::PasswordObserver), String> {
    let mut saves = BTreeMap::new();
    let mut hops = Vec::new();
    for h in route {
        let supplied = secrets.get(&h.id).cloned().unwrap_or_default();
        let (secret, update) =
            state
                .vault
                .primary(h)
                .prepare(supplied.into(), true, remember.contains(&h.id))?;
        if let Some(epoch) = update {
            saves.insert(h.id.clone(), epoch);
        }
        let expected = state
            .config
            .lock()
            .unwrap()
            .trusted_keys
            .get(&format!("{}:{}", h.address, h.port))
            .cloned();
        hops.push(tunnel::HopRequest {
            host: h.clone(),
            secret,
            expected,
        });
    }
    let observer: tunnel::PasswordObserver = Arc::new(move |host, password, method| {
        let Some(epoch) = saves.get(&host.id) else {
            return;
        };
        if !active()
            || !state
                .snapshot()
                .hosts
                .iter()
                .any(|h| h.id == host.id && h.diagnostics.is_empty() && h.matches_login(host))
        {
            return;
        }
        if let Err(error) = state.vault.primary(host).save(password, method, *epoch) {
            let _ = app.emit("tunnel://password-error", error);
        }
    });
    Ok((hops, observer))
}
pub(super) fn prompt(
    state: Arc<AppState>,
    id: String,
    active: Active,
    changed: TrustChanged,
) -> tunnel::TrustPrompt {
    Arc::new(move |endpoint, fingerprint, reply| {
        if !active() {
            return;
        }
        state.trust.lock().unwrap().insert(
            id.clone(),
            PendingTrust {
                run_id: id.clone(),
                endpoint: endpoint.clone(),
                fingerprint: fingerprint.clone(),
                reply,
            },
        );
        changed(endpoint, fingerprint);
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn workspace_login_checks_the_selected_default_and_matches_the_live_host_profile() {
        let mut host = Host {
            id: "fixture".into(),
            user: "original".into(),
            logins: vec![crate::model::LoginIdentity {
                id: "alternate".into(),
                label: String::new(),
                user: "selected user".into(),
                auth_method: AuthMethod::Password,
                identity_files: vec![],
            }],
            ..Default::default()
        };
        let primary = default_login(&host, Some("primary:fixture")).unwrap();
        host.default_login_id = Some("alternate".into());
        assert!(default_login(&host, Some("primary:fixture")).is_err());
        let alternate = default_login(&host, Some("alternate")).unwrap();
        assert_eq!(alternate.user, "selected user");
        assert!(host.matches_login(&alternate));
        assert!(host.matches_login(&primary));
        host.logins[0].user = "edited user".into();
        assert!(!host.matches_login(&alternate));
    }
}
