//! Resolve launch URLs from saved hosts and services, or from active forwards.
use crate::model::{ForwardKind, Host, Rule, Runtime, ServiceProtocol};
use std::net::IpAddr;

fn loopback(host: &str) -> bool {
    host.parse::<IpAddr>().is_ok_and(|ip| ip.is_loopback())
        || host.eq_ignore_ascii_case("localhost")
        || host.to_ascii_lowercase().ends_with(".localhost")
}

fn authority(host: &str) -> Result<String, String> {
    if let Ok(ip) = host.parse::<IpAddr>() {
        return Ok(match ip {
            IpAddr::V4(_) => ip.to_string(),
            IpAddr::V6(_) => format!("[{ip}]"),
        });
    }
    if host.is_empty()
        || host.len() > 253
        || !host.split('.').all(|label| {
            !label.is_empty()
                && label.len() <= 63
                && !label.starts_with('-')
                && !label.ends_with('-')
                && label
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'-')
        })
    {
        return Err(crate::native_message::plain("serviceAddress"));
    }
    Ok(host.into())
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DirectProtocol {
    Http,
    Https,
    Vnc,
    Postgresql,
    Mysql,
    Mongodb,
    Redis,
    Rediss,
}

impl DirectProtocol {
    fn scheme(self) -> &'static str {
        match self {
            DirectProtocol::Http => "http",
            DirectProtocol::Https => "https",
            DirectProtocol::Vnc => "vnc",
            DirectProtocol::Postgresql => "postgresql",
            DirectProtocol::Mysql => "mysql",
            DirectProtocol::Mongodb => "mongodb",
            DirectProtocol::Redis => "redis",
            DirectProtocol::Rediss => "rediss",
        }
    }
}

pub fn host_service_url(
    host: &Host,
    port: Option<u16>,
    protocol: DirectProtocol,
) -> Result<String, String> {
    let port = port
        .filter(|p| *p != 0)
        .ok_or_else(|| crate::native_message::plain("servicePort"))?;
    let scheme = protocol.scheme();
    Ok(format!("{scheme}://{}:{port}/", authority(&host.address)?))
}

pub fn service_url(rule: &Rule, host: &Host, runtime: &Runtime) -> Result<String, String> {
    let protocol = match rule
        .service_protocol
        .ok_or(crate::native_message::plain("serviceProtocol"))?
    {
        ServiceProtocol::Http => DirectProtocol::Http,
        ServiceProtocol::Https => DirectProtocol::Https,
        ServiceProtocol::Vnc => DirectProtocol::Vnc,
    };
    forwarded_url(rule, host, runtime, protocol)
}

pub fn linked_service_url(
    services: &[crate::commands::Service],
    service: &crate::commands::Service,
    rule: &Rule,
    host: &Host,
    runtime: &Runtime,
    protocol: DirectProtocol,
) -> Result<String, String> {
    if rule.kind != ForwardKind::L
        || !service.host_ids.contains(&rule.host_id)
        || service
            .direct_protocol
            .is_some_and(|saved| saved != protocol)
    {
        return Err("staleAction".into());
    }
    if !service.rule_ids.contains(&rule.id) {
        // Older L rules are grouped with the unique matching port on this host.
        let local_target = rule.target_host.eq_ignore_ascii_case(&host.address)
            || rule.target_host.eq_ignore_ascii_case("localhost")
            || matches!(rule.target_host.as_str(), "127.0.0.1" | "::1");
        let conflict = services.iter().any(|other| {
            other.id != service.id
                && other.host_ids.contains(&rule.host_id)
                && (other.rule_ids.contains(&rule.id) || other.port == service.port)
        });
        if !local_target || service.port != Some(rule.target_port) || conflict {
            return Err("staleAction".into());
        }
    }
    forwarded_url(rule, host, runtime, protocol)
}

pub(crate) fn forwarded_url(
    rule: &Rule,
    host: &Host,
    runtime: &Runtime,
    protocol: DirectProtocol,
) -> Result<String, String> {
    if runtime.rule_id != rule.id || runtime.status != "listening" {
        return Err(crate::native_message::plain("serviceListening"));
    }
    if runtime.configuration_changed {
        return Err(crate::native_message::plain("serviceHostChanged"));
    }
    let scheme = protocol.scheme();
    let bound = runtime.bound_address.map(|ip| ip.to_string());
    let address = match rule.kind {
        ForwardKind::D => return Err(crate::native_message::plain("serviceSocks")),
        ForwardKind::L => match bound.as_deref().unwrap_or(&rule.bind_address) {
            "0.0.0.0" => "127.0.0.1",
            "::" => "::1",
            address => address,
        },
        ForwardKind::R => {
            if loopback(&rule.bind_address) {
                return Err(crate::native_message::plain("serviceRemoteLoopback"));
            }
            match rule.bind_address.as_str() {
                "0.0.0.0" | "::" | "*" => host.address.as_str(),
                address => address,
            }
        }
    };
    let port = if rule.kind == ForwardKind::L {
        runtime.bound_port.unwrap_or(rule.bind_port)
    } else {
        rule.bind_port
    };
    if port == 0 {
        return Err(crate::native_message::plain("servicePort"));
    }
    let authority = authority(address)?;
    let url = tauri::Url::parse(&format!("{scheme}://{authority}:{port}/"))
        .map_err(|_| crate::native_message::plain("serviceAddress"))?;
    if rule.kind == ForwardKind::R
        && url
            .host_str()
            .is_some_and(|host| loopback(host.trim_matches(['[', ']'])))
    {
        return Err(crate::native_message::plain("serviceRemoteLoopback"));
    }
    Ok(url.into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn direct_service_uses_the_saved_service_port_and_a_valid_host() {
        let mut host = Host {
            address: "2001:db8::1".into(),
            port: 22,
            ..Default::default()
        };
        assert_eq!(
            host_service_url(&host, Some(25432), DirectProtocol::Postgresql).unwrap(),
            "postgresql://[2001:db8::1]:25432/"
        );
        assert!(host_service_url(&host, None, DirectProtocol::Vnc).is_err());
        assert!(host_service_url(&host, Some(0), DirectProtocol::Http).is_err());
        host.address = "server.invalid/path".into();
        assert!(host_service_url(&host, Some(8443), DirectProtocol::Https).is_err());
    }
    fn fixture() -> (Rule, Host, Runtime) {
        (
            Rule {
                id: "service-fixture".into(),
                service_protocol: Some(ServiceProtocol::Http),
                bind_port: 18080,
                ..Default::default()
            },
            Host {
                address: "ssh.example.invalid".into(),
                ..Default::default()
            },
            Runtime {
                rule_id: "service-fixture".into(),
                status: "listening".into(),
                ..Default::default()
            },
        )
    }
    #[test]
    fn schemes_and_local_listeners_use_the_forwarded_port() {
        let (mut rule, host, runtime) = fixture();
        assert_eq!(
            service_url(&rule, &host, &runtime).unwrap(),
            "http://127.0.0.1:18080/"
        );
        rule.bind_address = "0.0.0.0".into();
        rule.service_protocol = Some(ServiceProtocol::Https);
        assert_eq!(
            service_url(&rule, &host, &runtime).unwrap(),
            "https://127.0.0.1:18080/"
        );
        rule.bind_address = "::".into();
        rule.service_protocol = Some(ServiceProtocol::Vnc);
        assert_eq!(
            service_url(&rule, &host, &runtime).unwrap(),
            "vnc://[::1]:18080/"
        );
        rule.bind_address = "2001:db8::1".into();
        assert_eq!(
            service_url(&rule, &host, &runtime).unwrap(),
            "vnc://[2001:db8::1]:18080/"
        );
    }
    #[test]
    fn automatic_http_and_vnc_use_the_measured_listener() {
        let (mut rule, host, mut runtime) = fixture();
        rule.bind_port = 0;
        assert!(service_url(&rule, &host, &runtime).is_err());
        runtime.bound_address = Some("::1".parse().unwrap());
        runtime.bound_port = Some(51842);
        assert_eq!(
            service_url(&rule, &host, &runtime).unwrap(),
            "http://[::1]:51842/"
        );
        rule.service_protocol = Some(ServiceProtocol::Vnc);
        assert_eq!(
            service_url(&rule, &host, &runtime).unwrap(),
            "vnc://[::1]:51842/"
        );
        runtime.status = "stopped".into();
        assert!(service_url(&rule, &host, &runtime).is_err());
    }
    #[test]
    fn linked_service_uses_its_live_local_listener_with_the_inferred_protocol() {
        let (mut rule, host, mut rt) = fixture();
        rule.service_protocol = None;
        rule.host_id = "remote".into();
        let profile: crate::commands::Service = serde_json::from_value(serde_json::json!({
            "id":"web", "name":"Web", "revision":"v1", "hostIds":["remote"],
            "ruleIds":[rule.id], "actions":[], "port":13085, "noLocalEnvironment":true,
        }))
        .unwrap();
        rt.bound_port = Some(50881);
        let open = |rule: &Rule, rt: &Runtime| {
            linked_service_url(
                std::slice::from_ref(&profile),
                &profile,
                rule,
                &host,
                rt,
                DirectProtocol::Http,
            )
        };
        assert_eq!(open(&rule, &rt).unwrap(), "http://127.0.0.1:50881/");
        rt.configuration_changed = true;
        assert!(open(&rule, &rt).is_err());
        rt.configuration_changed = false;
        rule.host_id = "other".into();
        assert!(open(&rule, &rt).is_err());
        rule.host_id = "remote".into();
        rule.target_port = 13085;
        rule.target_host = "127.0.0.1".into();
        rule.id = "legacy".into();
        rt.rule_id.clone_from(&rule.id);
        assert_eq!(open(&rule, &rt).unwrap(), "http://127.0.0.1:50881/");
        let mut other = profile.clone();
        other.id = "second-service".into();
        assert!(linked_service_url(
            &[profile.clone(), other],
            &profile,
            &rule,
            &host,
            &rt,
            DirectProtocol::Http
        )
        .is_err());
    }
    #[test]
    fn remote_listener_is_explicit_and_dynamic_has_no_service_endpoint() {
        let (mut rule, host, runtime) = fixture();
        rule.kind = ForwardKind::R;
        for address in [
            "127.0.0.1",
            "127.1.2.3",
            "::1",
            "localhost",
            "x.localhost",
            "127.1",
            "0x7f000001",
        ] {
            rule.bind_address = address.into();
            assert!(service_url(&rule, &host, &runtime).is_err());
        }
        rule.bind_address = "0.0.0.0".into();
        assert_eq!(
            service_url(&rule, &host, &runtime).unwrap(),
            "http://ssh.example.invalid:18080/"
        );
        rule.bind_address = "service.example.invalid".into();
        assert_eq!(
            service_url(&rule, &host, &runtime).unwrap(),
            "http://service.example.invalid:18080/"
        );
        rule.kind = ForwardKind::D;
        assert!(service_url(&rule, &host, &runtime).is_err());
    }
    #[test]
    fn rejects_inactive_changed_or_unselected_services_and_url_injection() {
        let (mut rule, host, mut runtime) = fixture();
        for status in [
            "connecting",
            "stopped",
            "failed",
            "reconnecting",
            "verifying-host",
        ] {
            runtime.status = status.into();
            assert!(service_url(&rule, &host, &runtime).is_err());
        }
        runtime.status = "listening".into();
        runtime.configuration_changed = true;
        assert!(service_url(&rule, &host, &runtime).is_err());
        runtime.configuration_changed = false;
        rule.service_protocol = None;
        assert!(service_url(&rule, &host, &runtime).is_err());
        rule.service_protocol = Some(ServiceProtocol::Http);
        for address in [
            "evil.invalid/path",
            "user@evil.invalid",
            "x?y",
            "x#y",
            "x%2fy",
            " x",
            "x\n",
            "https://x",
            "-arg",
            "x;open",
        ] {
            rule.bind_address = address.into();
            assert!(service_url(&rule, &host, &runtime).is_err(), "{address:?}");
        }
    }
}
