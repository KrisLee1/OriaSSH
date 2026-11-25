//! Export a portable allowlist, never the internal config/trust/runtime document.
use crate::config_import::{self, MAX_HOSTS, MAX_RULES, MAX_SERVICES};
use crate::model::{rule_uses_host, Host, Rule, Snapshot};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
pub fn package(
    snapshot: &Snapshot,
    ids: &[String],
    include_key_paths: bool,
) -> Result<Value, String> {
    if ids.is_empty() {
        return Err(crate::native_message::plain("selectExportRules"));
    }
    let rules: Vec<_> = ids
        .iter()
        .map(|id| {
            snapshot
                .rules
                .iter()
                .find(|r| &r.id == id)
                .ok_or(crate::native_message::plain("exportRulesMissing"))
        })
        .collect::<Result<_, _>>()?;
    let hosts: Vec<_> = snapshot
        .hosts
        .iter()
        .filter(|h| {
            rules
                .iter()
                .any(|r| rule_uses_host(r, &snapshot.hosts, &h.id))
        })
        .map(|h| portable_host(h, include_key_paths))
        .collect();
    let rules: Vec<_> = rules.into_iter().map(portable_rule).collect();
    Ok(
        json!({"format":"oria-ssh","version":1,"hosts":hosts,"rules":rules,"credentialsIncluded":false,"runtimeIncluded":false}),
    )
}
fn portable_rule(r: &Rule) -> Value {
    json!({
        "id":r.id,"name":r.name,"color":r.color,"icon":r.icon,"serviceProtocol":r.service_protocol,
        "hostId":r.host_id,"kind":r.kind,"bindAddress":r.bind_address,"bindPort":r.bind_port,
        "targetHost":r.target_host,"targetPort":r.target_port,"connection":r.connection,
        "background":r.background,"reconnect":r.reconnect,"noRemoteCommand":r.no_remote_command,
        "remoteCommandOmitted":!r.no_remote_command,"autoConnect":false,"repeatCommandOnReconnect":false,
    })
}
fn portable_host(h: &Host, include_key_paths: bool) -> Value {
    let mut host = json!({
        "id":h.id,"name":h.name,"address":h.address,"port":h.port,"user":h.user,"authMethod":h.auth_method,
        "tags":h.tags,"connection":h.connection,"proxyJump":h.proxy_jump,"identitiesOnly":h.identities_only,"algorithms":h.algorithms,
        "identityFiles":if include_key_paths {h.identity_files.clone()}else{Vec::new()},
        "identityFilesOmitted":!include_key_paths&&(!h.identity_files.is_empty() || h.logins.iter().any(|l|!l.identity_files.is_empty())),"connectionBlocked":!h.diagnostics.is_empty()
    });
    if !h.logins.is_empty() {
        let mut logins = h.logins.clone();
        if !include_key_paths {
            for login in &mut logins {
                login.identity_files.clear();
            }
        }
        host["logins"] = json!(logins);
        host["defaultLoginId"] = json!(h.default_login_id);
    }
    if let Some(appearance) = &h.appearance {
        host["appearance"] = json!(appearance);
    }
    host
}
pub fn package_with_services(
    snapshot: &Snapshot,
    ids: &[String],
    service_ids: &[String],
    include_key_paths: bool,
) -> Result<Value, String> {
    if service_ids.is_empty() {
        return package(snapshot, ids, include_key_paths);
    }
    let wanted: std::collections::BTreeSet<_> = service_ids.iter().collect();
    if wanted.len() != service_ids.len() || wanted.len() > 256 {
        return Err("invalidServicePackage".into());
    }
    let services = service_ids
        .iter()
        .map(|id| {
            snapshot
                .services
                .iter()
                .find(|s| &s.id == id)
                .ok_or("serviceMissing")
        })
        .collect::<Result<Vec<_>, _>>()?;
    let mut value = if ids.is_empty() {
        json!({"format":"oria-ssh","version":1,"hosts":[],"rules":[],"credentialsIncluded":false,"runtimeIncluded":false})
    } else {
        package(snapshot, ids, include_key_paths)?
    };
    let mut hosts = value["hosts"].as_array().unwrap().clone();
    for host in &snapshot.hosts {
        if services.iter().any(|s| {
            s.host_ids.iter().any(|id| {
                rule_uses_host(
                    &crate::model::Rule {
                        host_id: id.clone(),
                        ..Default::default()
                    },
                    &snapshot.hosts,
                    &host.id,
                )
            })
        }) && !hosts
            .iter()
            .any(|saved| saved["id"].as_str() == Some(&host.id))
        {
            hosts.push(portable_host(host, include_key_paths));
        }
    }
    let mut profiles = Vec::new();
    for service in services {
        service.validate()?;
        let links: Vec<_> = service
            .rule_ids
            .iter()
            .filter(|id| ids.contains(id))
            .collect();
        let host_ids: Vec<_> = service
            .host_ids
            .iter()
            .filter(|id| hosts.iter().any(|h| h["id"].as_str() == Some(id)))
            .collect();
        profiles.push(portable_service(service, host_ids, links));
    }
    value["version"] = json!(2);
    value["hosts"] = json!(hosts);
    value["services"] = json!(profiles);
    if hosts.len() > 500
        || serde_json::to_vec_pretty(&value)
            .map_err(|_| "invalidServicePackage")?
            .len()
            > crate::config_import::MAX_BYTES
    {
        return Err("servicePackageLimit".into());
    }
    // Export is subject to the same strict boundary as the eventual import.
    crate::config_import::parse(&serde_json::to_vec(&value).map_err(|_| "invalidServicePackage")?)?;
    Ok(value)
}
fn portable_service(
    service: &crate::commands::Service,
    host_ids: Vec<&String>,
    rule_ids: Vec<&String>,
) -> Value {
    let mut value = json!({
        "id":service.id,"name":service.name,"category":service.category,"color":service.color,
        "icon":service.icon,"port":service.port,"executionHostId":"","hostIds":host_ids,
        "ruleIds":rule_ids,"noLocalEnvironment":service.no_local_environment,
        "actions":service.actions,"control":service.control,
    });
    if !service.login_by_host.is_empty() {
        value["loginByHost"] = json!(service
            .login_by_host
            .iter()
            .filter(|(host, _)| host_ids.contains(host))
            .collect::<BTreeMap<_, _>>());
    }
    if let Some(protocol) = service.direct_protocol {
        value["directProtocol"] = json!(protocol);
    }
    value
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkspaceSelection {
    pub host_ids: Vec<String>,
    pub rule_ids: Vec<String>,
    pub service_ids: Vec<String>,
    pub include_service_commands: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspacePreview {
    pub fingerprint: String,
    pub hosts: Vec<ExportHost>,
    pub service_count: usize,
    pub rule_count: usize,
    pub logins: Vec<ExportLogin>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportLogin {
    id: String,
    label: String,
    user: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportHost {
    id: String,
    name: String,
    endpoint: String,
    dependency: bool,
}

pub fn workspace(
    snapshot: &Snapshot,
    selection: &WorkspaceSelection,
) -> Result<(Value, WorkspacePreview), String> {
    let invalid = || crate::native_message::plain("exportSelectionInvalid");
    let host_ids = selection
        .host_ids
        .iter()
        .map(String::as_str)
        .collect::<BTreeSet<_>>();
    let rule_ids = selection
        .rule_ids
        .iter()
        .map(String::as_str)
        .collect::<BTreeSet<_>>();
    let service_ids = selection
        .service_ids
        .iter()
        .map(String::as_str)
        .collect::<BTreeSet<_>>();
    if host_ids.len() != selection.host_ids.len()
        || rule_ids.len() != selection.rule_ids.len()
        || service_ids.len() != selection.service_ids.len()
        || host_ids
            .iter()
            .any(|id| !snapshot.added_host_ids.iter().any(|added| added == id))
        || (host_ids.is_empty() && rule_ids.is_empty() && service_ids.is_empty())
    {
        return Err(invalid());
    }
    if host_ids.len() > MAX_HOSTS || rule_ids.len() > MAX_RULES || service_ids.len() > MAX_SERVICES
    {
        return Err(crate::native_message::plain("configLimits"));
    }
    let rules = snapshot
        .rules
        .iter()
        .filter(|rule| rule_ids.contains(rule.id.as_str()))
        .collect::<Vec<_>>();
    let services = snapshot
        .services
        .iter()
        .filter(|service| service_ids.contains(service.id.as_str()))
        .collect::<Vec<_>>();
    if rules.len() != rule_ids.len() || services.len() != service_ids.len() {
        return Err(invalid());
    }
    if !selection.include_service_commands
        && services
            .iter()
            .any(|service| !service.actions.is_empty() || service.control.health_probe.is_some())
    {
        return Err(crate::native_message::plain("exportCommandsRequired"));
    }
    let hosts = snapshot
        .hosts
        .iter()
        .map(|host| (host.id.as_str(), host))
        .collect::<BTreeMap<_, _>>();
    let mut required = BTreeSet::new();
    let mut pending = host_ids
        .iter()
        .copied()
        .chain(rules.iter().map(|rule| rule.host_id.as_str()))
        .chain(
            services
                .iter()
                .flat_map(|service| service.host_ids.iter().map(String::as_str)),
        )
        .collect::<Vec<_>>();
    while let Some(id) = pending.pop() {
        if !required.insert(id) {
            continue;
        }
        let host = hosts.get(id).ok_or_else(invalid)?;
        if let Some(jumps) = &host.proxy_jump {
            pending.extend(jumps.split(',').map(str::trim));
        }
    }
    if required.len() > MAX_HOSTS {
        return Err(crate::native_message::plain("configLimits"));
    }
    let mut projected = Vec::new();
    let mut preview_hosts = Vec::new();
    let mut credential_ids = BTreeSet::new();
    for id in required {
        let host = hosts[id];
        let mut value = portable_host(host, false);
        let local = host
            .logins
            .iter()
            .filter(|login| !host.credential_ids.contains(&login.id))
            .cloned()
            .map(|mut login| {
                login.identity_files.clear();
                login
            })
            .collect::<Vec<_>>();
        value["logins"] = json!(local);
        value["defaultLoginId"] = json!(host.default_login_id);
        value["credentialIds"] = json!(host.credential_ids);
        value["credentialOnly"] = json!(host.credential_only);
        value["primaryLoginLabel"] = json!(host.primary_login_label);
        credential_ids.extend(host.credential_ids.iter().map(String::as_str));
        projected.push(value);
        preview_hosts.push(ExportHost {
            id: host.id.clone(),
            name: host.name.clone(),
            endpoint: format!("{}@{}:{}", host.user, host.address, host.port),
            dependency: !host_ids.contains(id),
        });
    }
    let catalog = snapshot
        .login_credentials
        .iter()
        .map(|login| (login.id.as_str(), login))
        .collect::<BTreeMap<_, _>>();
    let login_credentials = credential_ids
        .into_iter()
        .map(|id| {
            let mut login = (*catalog.get(id).ok_or_else(invalid)?).clone();
            login.identity_files.clear();
            Ok(login)
        })
        .collect::<Result<Vec<_>, String>>()?;
    let profiles = services
        .iter()
        .map(|service| {
            portable_service(
                service,
                service.host_ids.iter().collect(),
                service
                    .rule_ids
                    .iter()
                    .filter(|id| rule_ids.contains(id.as_str()))
                    .collect(),
            )
        })
        .collect::<Vec<_>>();
    let value = json!({
        "format":"oria-ssh","version":3,"hosts":projected,
        "rules":rules.into_iter().map(portable_rule).collect::<Vec<_>>(),
        "services":profiles,"loginCredentials":login_credentials,
        "selectedHostIds":host_ids,"credentialsIncluded":false,"runtimeIncluded":false,
    });
    let bytes = serde_json::to_vec_pretty(&value).map_err(|_| invalid())?;
    config_import::parse(&bytes)?;
    let preview = WorkspacePreview {
        fingerprint: format!("{:x}", Sha256::digest(&bytes)),
        hosts: preview_hosts,
        service_count: service_ids.len(),
        rule_count: rule_ids.len(),
        logins: login_credentials
            .into_iter()
            .map(|login| ExportLogin {
                id: login.id,
                label: login.label,
                user: login.user,
            })
            .collect(),
    };
    Ok((value, preview))
}

pub fn reviewed_workspace(
    snapshot: &Snapshot,
    selection: &WorkspaceSelection,
    fingerprint: &str,
) -> Result<Value, String> {
    let (value, preview) = workspace(snapshot, selection)?;
    if preview.fingerprint == fingerprint {
        Ok(value)
    } else {
        Err(crate::native_message::plain("exportPreviewChanged"))
    }
}

pub fn write(path: &std::path::Path, value: &Value) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(value)
        .map_err(|_| crate::native_message::plain("exportFailed"))?;
    if bytes.len() > config_import::MAX_BYTES {
        return Err(crate::native_message::plain("configTooLarge"));
    }
    let temp = path.with_file_name(format!(".oria-export-{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| {
        use std::io::Write;
        let mut f = std::fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temp)?;
        f.write_all(&bytes)?;
        f.sync_all()?;
        drop(f);
        std::fs::rename(&temp, path)
    })()
    .map_err(|_: std::io::Error| crate::native_message::plain("exportFailed"));
    if result.is_err() {
        let _ = std::fs::remove_file(temp);
    }
    result
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::*;
    #[test]
    fn allowlist_omits_commands_trust_sources_and_secrets_and_retains_route() {
        let jump = Host {
            id: "jump".into(),
            name: "jump".into(),
            ..Default::default()
        };
        let host = Host {
            id: "target".into(),
            name: "target".into(),
            proxy_jump: Some("jump".into()),
            identity_files: vec!["CANARY_PATH".into()],
            configured_forwards: vec!["CANARY_CONFIG".into()],
            source_file: Some("CANARY_SOURCE".into()),
            ..Default::default()
        };
        let rule = Rule {
            id: "rule".into(),
            host_id: "target".into(),
            remote_command: "CANARY_PASSWORD".into(),
            no_remote_command: false,
            auto_connect: true,
            ..Default::default()
        };
        let s = Snapshot {
            hosts: vec![
                jump,
                host,
                Host {
                    id: "unrelated".into(),
                    ..Default::default()
                },
            ],
            rules: vec![rule],
            ..Default::default()
        };
        let value = package(&s, &["rule".into()], false).unwrap();
        let text = value.to_string();
        assert!(!text.contains("CANARY"));
        assert!(!text.contains("unrelated"));
        assert_eq!(value["hosts"].as_array().unwrap().len(), 2);
        assert_eq!(value["rules"][0]["autoConnect"], false);
        assert_eq!(value["rules"][0]["remoteCommandOmitted"], true);
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("export.json");
        write(&file, &value).unwrap();
        assert_eq!(
            serde_json::from_slice::<Value>(&std::fs::read(&file).unwrap()).unwrap(),
            value
        );
        #[cfg(windows)]
        {
            use std::os::windows::fs::OpenOptionsExt;
            std::fs::write(&file, b"existing-export").unwrap();
            let locked = std::fs::OpenOptions::new()
                .read(true)
                .share_mode(0)
                .open(&file)
                .unwrap();
            assert!(write(&file, &value).is_err());
            drop(locked);
            assert_eq!(std::fs::read(&file).unwrap(), b"existing-export");
            assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
        }
        assert!(package(&s, &["missing".into()], false).is_err());
    }
}
