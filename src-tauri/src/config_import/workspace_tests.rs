use super::*;
use crate::config_export::{self, WorkspaceSelection};
use crate::model::{HostAppearance, Runtime};
use serde_json::{json, Value};

const SHARED: &str = "646da2e5-0d03-4454-ac69-25e39b0b9fd6";
const LOCAL: &str = "87f4fb77-2647-4895-a920-8690a5294839";

fn ids(values: &[&str]) -> Vec<String> {
    values.iter().map(|value| (*value).into()).collect()
}

fn host(id: &str) -> Host {
    Host {
        id: id.into(),
        name: id.into(),
        address: format!("{id}.invalid"),
        port: 22,
        user: "base account".into(),
        source: "manual".into(),
        ..Default::default()
    }
}

fn selection(hosts: &[&str], rules: &[&str], services: &[&str]) -> WorkspaceSelection {
    WorkspaceSelection {
        host_ids: ids(hosts),
        rule_ids: ids(rules),
        service_ids: ids(services),
        include_service_commands: true,
    }
}

fn rule(id: &str, host: &str, kind: ForwardKind, bind_port: u16, login: &str) -> Rule {
    Rule {
        id: id.into(),
        name: id.into(),
        host_id: host.into(),
        kind,
        bind_address: "127.0.0.1".into(),
        bind_port,
        target_host: "localhost".into(),
        target_port: 9000,
        login_identity_id: Some(login.into()),
        auto_connect: true,
        repeat_command_on_reconnect: true,
        ..Default::default()
    }
}

fn workspace_fixture() -> Snapshot {
    let shared = LoginIdentity {
        id: SHARED.into(),
        label: "shared deploy".into(),
        user: "fixture deploy".into(),
        auth_method: AuthMethod::PrivateKey,
        identity_files: ids(&["/unexportable/identity"]),
    };
    let local = LoginIdentity {
        id: LOCAL.into(),
        label: "host-only login".into(),
        user: "fixture admin".into(),
        auth_method: AuthMethod::Agent,
        identity_files: vec![],
    };
    let make_host = |id: &str| Host {
        credential_only: true,
        credential_ids: ids(&[SHARED]),
        default_login_id: Some(SHARED.into()),
        logins: vec![shared.clone()],
        user: shared.user.clone(),
        auth_method: shared.auth_method.clone(),
        identity_files: shared.identity_files.clone(),
        proxy_jump: Some("jump".into()),
        ..host(id)
    };
    let alpha = make_host("alpha");
    let mut beta = make_host("beta");
    beta.logins.push(local);
    let standalone = Host {
        appearance: Some(HostAppearance {
            color: Some("#123456".into()),
            icon: None,
        }),
        primary_login_label: "standalone base".into(),
        tags: ids(&["offline"]),
        ..host("standalone")
    };
    let template = crate::service_templates::build("systemdUser", "fixture").unwrap();
    let mut service = crate::commands::Service {
        id: "service".into(),
        name: "service".into(),
        revision: "fixture".into(),
        host_ids: ids(&["alpha", "beta"]),
        rule_ids: ids(&["local", "remote", "dynamic"]),
        port: Some(9000),
        login_by_host: BTreeMap::from([
            ("alpha".into(), SHARED.into()),
            ("beta".into(), LOCAL.into()),
        ]),
        actions: template.actions,
        control: template.control,
        execution_enabled: true,
        no_local_environment: true,
        execution_host_id: String::new(),
        category: None,
        color: None,
        icon: None,
        direct_protocol: None,
    };
    service.control.check_after_actions = true;
    Snapshot {
        added_host_ids: ids(&["standalone", "alpha", "beta", "jump"]),
        hosts: vec![alpha, beta, host("jump"), standalone, host("unrelated")],
        rules: vec![
            rule("local", "alpha", ForwardKind::L, 0, SHARED),
            rule("remote", "beta", ForwardKind::R, 17654, LOCAL),
            rule("dynamic", "beta", ForwardKind::D, 0, SHARED),
        ],
        services: vec![service],
        login_credentials: vec![shared],
        runtimes: vec![Runtime::default()],
        ..Default::default()
    }
}

#[test]
fn standalone_host_file_round_trip() {
    let snapshot = workspace_fixture();
    let (document, review) =
        config_export::workspace(&snapshot, &selection(&["standalone"], &[], &[])).unwrap();
    assert_eq!(document["selectedHostIds"], json!(["standalone"]));
    assert_eq!(review.hosts.len(), 1);
    assert_eq!(review.service_count, 0);
    assert_eq!(review.rule_count, 0);
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("workspace.json");
    config_export::write(&path, &document).unwrap();
    let (bytes, name) = ImportSource::Path {
        path: path.to_string_lossy().into_owned(),
    }
    .read()
    .unwrap();
    let (upload, _) = ImportSource::Upload {
        file_name: name.clone(),
        content: String::from_utf8(bytes.clone()).unwrap(),
    }
    .read()
    .unwrap();
    assert_eq!(upload, bytes);
    let package = parse(&bytes).unwrap();
    let preview = package.preview(&Snapshot::default(), "test".into(), name);
    assert_eq!(preview.selected_host_ids, Some(ids(&["standalone"])));
    assert_eq!(preview.hosts[0].logins[0].label, "standalone base");
    let plan = package
        .prepare(
            &Snapshot::default(),
            &Choices {
                host_ids: ids(&["standalone"]),
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(plan.hosts.len(), 1);
    assert!(plan.rules.is_empty() && plan.services.is_empty());
    assert_ne!(plan.hosts[0].id, "standalone");
    assert_eq!(plan.hosts[0].appearance, snapshot.hosts[3].appearance);
    assert_eq!(plan.hosts[0].tags, ids(&["offline"]));
}

#[test]
fn migration_preserves_shared_graph_and_l_r_d_without_enabling_execution() {
    let snapshot = workspace_fixture();
    let scope = selection(
        &["standalone", "alpha", "beta", "jump"],
        &["local", "remote", "dynamic"],
        &["service"],
    );
    let (document, review) = config_export::workspace(&snapshot, &scope).unwrap();
    assert_eq!(review.hosts.len(), 4);
    assert_eq!(review.logins.len(), 1);
    assert_eq!(document["loginCredentials"][0]["identityFiles"], json!([]));
    assert_eq!(document["runtimeIncluded"], false);
    let alpha = document["hosts"]
        .as_array()
        .unwrap()
        .iter()
        .find(|value| value["id"] == "alpha")
        .unwrap();
    assert_eq!(alpha["logins"], json!([]));
    assert_eq!(alpha["credentialIds"], json!([SHARED]));
    assert_eq!(alpha["identityFilesOmitted"], true);
    let text = document.to_string();
    assert!(
        !text.contains("/unexportable")
            && !text.contains("unrelated")
            && !text.contains("executionEnabled")
    );

    let package = parse(text.as_bytes()).unwrap();
    let choices = Choices {
        host_ids: scope.host_ids,
        service_ids: scope.service_ids,
        rule_ids: scope.rule_ids,
        ..Default::default()
    };
    let plan = package.prepare(&Snapshot::default(), &choices).unwrap();
    let repeated = package.prepare(&Snapshot::default(), &choices).unwrap();
    assert_eq!(plan.login_credentials.len(), 1);
    let shared = plan.login_credentials.values().next().unwrap();
    assert_ne!(shared.id, SHARED);
    assert!(!repeated.login_credentials.contains_key(&shared.id));
    assert_eq!(shared.user, "fixture deploy");
    let alpha = plan.hosts.iter().find(|h| h.name == "alpha").unwrap();
    let beta = plan.hosts.iter().find(|h| h.name == "beta").unwrap();
    for linked in [alpha, beta] {
        assert!(linked.credential_only);
        assert_eq!(linked.credential_ids, vec![shared.id.clone()]);
        assert_eq!(linked.default_login_id, Some(shared.id.clone()));
        let route = crate::model::resolve_jumps(&plan.hosts, linked).unwrap();
        assert_eq!(route[0].name, "jump");
        assert_ne!(route[0].id, "jump");
    }
    assert_ne!(beta.logins[0].id, LOCAL);
    let service = &plan.services[0];
    assert!(!service.execution_enabled && !service.control.check_after_actions);
    assert!(service.host_ids.contains(&alpha.id) && service.host_ids.contains(&beta.id));
    assert_eq!(service.login_by_host[&alpha.id], shared.id);
    assert_eq!(service.login_by_host[&beta.id], beta.logins[0].id);
    assert_eq!(service.rule_ids.len(), 3);
    for imported in &plan.rules {
        assert!(service.rule_ids.contains(&imported.id));
        assert!(!imported.auto_connect && !imported.repeat_command_on_reconnect);
        let before = snapshot
            .rules
            .iter()
            .find(|candidate| candidate.kind == imported.kind)
            .unwrap();
        assert_eq!(imported.bind_port, before.bind_port);
        assert_eq!(imported.target_port, before.target_port);
    }
}

#[test]
fn share_limits_scope_and_requires_opt_in_for_executable_content() {
    let snapshot = workspace_fixture();
    let mut scope = selection(&[], &[], &["service"]);
    scope.include_service_commands = false;
    assert!(config_export::workspace(&snapshot, &scope)
        .err()
        .unwrap()
        .contains("exportCommandsRequired"));
    scope.include_service_commands = true;
    let (document, review) = config_export::workspace(&snapshot, &scope).unwrap();
    assert_eq!(review.hosts.len(), 3);
    assert_eq!(document["selectedHostIds"], json!([]));
    assert_eq!(document["rules"], json!([]));
    assert_eq!(document["services"][0]["ruleIds"], json!([]));
    let package = parse(document.to_string().as_bytes()).unwrap();
    let plan = package
        .prepare(
            &Snapshot::default(),
            &Choices {
                service_ids: ids(&["service"]),
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(plan.hosts.len(), 3);
    assert_eq!(plan.services[0].host_ids.len(), 2);
    assert!(plan.rules.is_empty());

    let scope = selection(&[], &["local"], &[]);
    let (document, review) = config_export::workspace(&snapshot, &scope).unwrap();
    assert_eq!(review.hosts.len(), 2);
    assert_eq!(document["services"], json!([]));
    assert!(config_export::workspace(&snapshot, &selection(&["unrelated"], &[], &[])).is_err());
    assert!(config_export::workspace(
        &snapshot,
        &selection(&["standalone", "standalone"], &[], &[])
    )
    .is_err());
}

#[test]
fn reused_forward_uses_the_existing_hosts_current_credential() {
    let source = workspace_fixture();
    let (mut document, _) =
        config_export::workspace(&source, &selection(&[], &["local"], &[])).unwrap();
    assert!(document["rules"][0].get("loginIdentityId").is_none());
    document["rules"][0]["loginIdentityId"] = SHARED.into();
    document["rules"][0]["followHostLogin"] = false.into();
    let package = parse(document.to_string().as_bytes()).unwrap();
    let mut destination_host = host("existing");
    destination_host.logins.push(LoginIdentity {
        id: LOCAL.into(),
        label: "Fixture".into(),
        user: "deploy".into(),
        auth_method: AuthMethod::Agent,
        identity_files: vec![],
    });
    destination_host.default_login_id = Some(LOCAL.into());
    let destination = Snapshot {
        hosts: vec![destination_host.clone()],
        added_host_ids: ids(&["existing"]),
        ..Default::default()
    };
    let choices = Choices {
        rule_ids: ids(&["local"]),
        reuse_hosts: BTreeMap::from([("alpha".into(), "existing".into())]),
        ..Default::default()
    };
    let imported = package.prepare(&destination, &choices).unwrap();
    assert!(imported.hosts.is_empty() && imported.login_credentials.is_empty());
    assert_eq!(imported.rules[0].host_id, "existing");
    assert_eq!(imported.rules[0].login_identity_id, Some(LOCAL.into()));
    assert_eq!(destination.hosts[0], destination_host);
}

#[test]
fn v3_strict_boundary_rejects_hidden_fields_paths_and_dangling_references() {
    let source = workspace_fixture();
    let (document, _) =
        config_export::workspace(&source, &selection(&["alpha"], &[], &[])).unwrap();
    let reject = |mut value: Value, change: &dyn Fn(&mut Value)| {
        change(&mut value);
        assert!(parse(value.to_string().as_bytes()).is_err());
    };
    for change in [
        (|value: &mut Value| value["version"] = 2.into()) as fn(&mut Value),
        |value: &mut Value| value["loginCredentials"][0]["password"] = "SENSITIVE_FIXTURE".into(),
        |value: &mut Value| value["loginCredentials"][0]["identityFiles"] = json!(["/local/key"]),
        |value: &mut Value| value["loginCredentials"] = json!([]),
        |value: &mut Value| value["selectedHostIds"] = json!(["unknown"]),
        |value: &mut Value| value["hosts"][0]["defaultLoginId"] = LOCAL.into(),
        |value: &mut Value| value["hosts"][0]["proxyJump"] = "alpha".into(),
        |value: &mut Value| value["runtimeIncluded"] = true.into(),
        |value: &mut Value| value["credentialsIncluded"] = true.into(),
    ] {
        reject(document.clone(), &change);
    }
}

#[test]
fn review_fingerprint_ignores_runtime_but_covers_exported_content() {
    let mut source = workspace_fixture();
    let scope = selection(&["standalone"], &[], &[]);
    let (_, preview) = config_export::workspace(&source, &scope).unwrap();
    source.revision += 1;
    source.runtimes.clear();
    let (_, same) = config_export::workspace(&source, &scope).unwrap();
    assert_eq!(preview.fingerprint, same.fingerprint);
    config_export::reviewed_workspace(&source, &scope, &preview.fingerprint).unwrap();
    source.hosts[3].name = "changed".into();
    let (_, changed) = config_export::workspace(&source, &scope).unwrap();
    assert_ne!(preview.fingerprint, changed.fingerprint);
    assert!(
        config_export::reviewed_workspace(&source, &scope, &preview.fingerprint)
            .unwrap_err()
            .contains("exportPreviewChanged")
    );
}

#[test]
fn workspace_reports_conflicts_without_changing_the_requested_listener() {
    let source = workspace_fixture();
    let (document, _) =
        config_export::workspace(&source, &selection(&[], &["remote"], &[])).unwrap();
    let package = parse(document.to_string().as_bytes()).unwrap();
    let mut existing_rule = source.rules[1].clone();
    existing_rule.id = "existing".into();
    let destination = Snapshot {
        hosts: vec![host("beta")],
        rules: vec![existing_rule.clone()],
        ..Default::default()
    };
    let preview = package.preview(&destination, "token".into(), "workspace.json".into());
    assert!(preview.rules[0].listener_conflict && preview.rules[0].conflict);
    let plan = package
        .prepare(
            &destination,
            &Choices {
                rule_ids: ids(&["remote"]),
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(plan.rules[0].name, "remote (2)");
    assert_eq!(plan.rules[0].bind_port, existing_rule.bind_port);
    assert!(!plan.rules[0].auto_connect);
}

#[test]
fn workspace_size_limit_applies_to_the_pretty_file_before_replacing_anything() {
    let hosts = (0..12)
        .map(|index| Host {
            tags: vec!["x".repeat(3900); 50],
            ..host(&format!("host-{index}"))
        })
        .collect::<Vec<_>>();
    let selected = hosts.iter().map(|host| host.id.clone()).collect::<Vec<_>>();
    let snapshot = Snapshot {
        hosts,
        added_host_ids: selected.clone(),
        ..Default::default()
    };
    let scope = WorkspaceSelection {
        host_ids: selected,
        ..selection(&[], &[], &[])
    };
    assert!(config_export::workspace(&snapshot, &scope)
        .err()
        .unwrap()
        .contains("configTooLarge"));

    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("existing.json");
    std::fs::write(&path, b"original fixture").unwrap();
    let too_large = json!({"payload": "x".repeat(MAX_BYTES)});
    assert!(config_export::write(&path, &too_large)
        .unwrap_err()
        .contains("configTooLarge"));
    assert_eq!(std::fs::read(&path).unwrap(), b"original fixture");
    assert_eq!(std::fs::read_dir(directory.path()).unwrap().count(), 1);
}
