//! Passwords stay in the OS vault. Connection attempts may update them after authentication.
use crate::{
    model::{AuthMethod, Host, LoginIdentity},
    tunnel::Secret,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, path::Path, sync::Mutex};
use zeroize::{Zeroize, Zeroizing};

pub struct Vault {
    scope: String,
    epochs: Mutex<BTreeMap<String, u64>>,
}
#[derive(Deserialize)]
struct Stored {
    binding: String,
    password: String,
}
impl Drop for Stored {
    fn drop(&mut self) {
        self.password.zeroize();
    }
}
fn hash(value: &[u8]) -> String {
    format!("{:x}", Sha256::digest(value))
}
pub fn binding(host: &Host) -> String {
    hash(&serde_json::to_vec(&(&host.address, host.port, &host.user, &host.auth_method)).unwrap())
}
impl Vault {
    pub fn vnc(&self, binding: &[u8]) -> VncCredential {
        VncCredential(format!(
            "OriaTunnel/vnc/v1/{}/{}",
            self.scope,
            hash(binding)
        ))
    }
    pub fn new(path: &Path) -> Self {
        Self {
            scope: hash(path.to_string_lossy().as_bytes()),
            epochs: Mutex::new(BTreeMap::new()),
        }
    }
    // Only the stable original login may claim the old host-scoped key.
    // Selecting another default later must never transfer access to the v1 entry.
    pub fn primary(&self, host: &Host) -> LoginPassword<'_> {
        if let Some(id) = host
            .active_login_id
            .as_deref()
            .filter(|id| host.credential_ids.iter().any(|linked| linked == *id))
        {
            return self.shared(id, &host.user, &host.auth_method);
        }
        self.login(
            host,
            host.active_login_id
                .as_deref()
                .unwrap_or(&crate::model::primary_login_id(&host.id)),
        )
    }

    pub fn credential(&self, credential: &LoginIdentity) -> LoginPassword<'_> {
        self.shared(&credential.id, &credential.user, &credential.auth_method)
    }

    fn shared(&self, id: &str, user: &str, method: &AuthMethod) -> LoginPassword<'_> {
        let key = hash(id.as_bytes());
        LoginPassword {
            vault: self,
            binding: hash(&serde_json::to_vec(&(user, method)).unwrap()),
            eligible: method.accepts_password(),
            discard_mismatch: false,
            target: format!("OriaTunnel/ssh-credential/v1/{}/{key}", self.scope),
            legacy: None,
        }
    }

    fn login(&self, host: &Host, identity_id: &str) -> LoginPassword<'_> {
        let key = hash(&serde_json::to_vec(&(&host.id, identity_id)).unwrap());
        LoginPassword {
            vault: self,
            binding: binding(host),
            eligible: host.auth_method.accepts_password(),
            discard_mismatch: true,
            target: format!("OriaTunnel/password/v2/{}/{key}", self.scope),
            legacy: (identity_id == crate::model::primary_login_id(&host.id)).then(|| {
                format!(
                    "OriaTunnel/password/v1/{}/{}",
                    self.scope,
                    hash(host.id.as_bytes())
                )
            }),
        }
    }
}

pub struct LoginPassword<'a> {
    vault: &'a Vault,
    binding: String,
    eligible: bool,
    discard_mismatch: bool,
    target: String,
    legacy: Option<String>,
}

type LegacyPassword<'a> = (&'a str, Zeroizing<Vec<u8>>);

fn decode(bytes: &[u8]) -> Result<Stored, String> {
    serde_json::from_slice(bytes).map_err(|_| crate::native_message::plain("savedPasswordInvalid"))
}

impl LoginPassword<'_> {
    pub fn epoch(&self) -> u64 {
        *self
            .vault
            .epochs
            .lock()
            .unwrap()
            .get(&self.target)
            .unwrap_or(&0)
    }

    fn matching_legacy(&self) -> Result<Option<Zeroizing<Vec<u8>>>, String> {
        let Some(key) = &self.legacy else {
            return Ok(None);
        };
        let Some(bytes) = platform::read(key)? else {
            return Ok(None);
        };
        Ok((decode(&bytes)?.binding == self.binding).then_some(bytes))
    }

    fn legacy_for_removal(
        &self,
        forget_invalid: bool,
    ) -> Result<Option<LegacyPassword<'_>>, String> {
        let Some(key) = &self.legacy else {
            return Ok(None);
        };
        let Some(bytes) = platform::read(key)? else {
            return Ok(None);
        };
        // A malformed v1 entry must not prevent use of a valid v2 password.
        // Explicit credential edits may discard it.
        let remove = match decode(&bytes) {
            Ok(stored) => stored.binding == self.binding,
            Err(_) => forget_invalid,
        };
        Ok(remove.then_some((key, bytes)))
    }

    fn clear_matching_legacy(&self, forget_invalid: bool) -> Result<(), String> {
        if let Some((key, _)) = self.legacy_for_removal(forget_invalid)? {
            platform::delete(key)?;
        }
        Ok(())
    }

    pub fn read(&self) -> Result<Option<Secret>, String> {
        let mut epochs = self.vault.epochs.lock().unwrap();
        let bytes = match platform::read(&self.target)? {
            Some(current) => current,
            None => {
                let Some(old) = self.matching_legacy()? else {
                    return Ok(None);
                };
                platform::write(&self.target, &old)?;
                old
            }
        };
        let mut stored = decode(&bytes)?;
        if stored.binding != self.binding {
            if self.discard_mismatch {
                *epochs.entry(self.target.clone()).or_default() += 1;
                platform::delete(&self.target)?;
            }
            return Ok(None);
        }
        // A failed delete can be retried with the already-committed v2 entry.
        self.clear_matching_legacy(false)?;
        if !self.eligible {
            return Ok(None);
        }
        Ok(Some(Secret::password(std::mem::take(&mut stored.password))))
    }

    pub fn save(&self, password: &str, method: AuthMethod, epoch: u64) -> Result<(), String> {
        let epochs = self.vault.epochs.lock().unwrap();
        if !self.eligible
            || method != AuthMethod::Password
            || password.is_empty()
            || *epochs.get(&self.target).unwrap_or(&0) != epoch
        {
            return Ok(());
        }
        self.write(password)?;
        self.clear_matching_legacy(false)
    }

    fn write(&self, password: &str) -> Result<(), String> {
        #[derive(Serialize)]
        struct Payload<'a> {
            binding: &'a str,
            password: &'a str,
        }
        let bytes = Zeroizing::new(
            serde_json::to_vec(&Payload {
                binding: &self.binding,
                password,
            })
            .map_err(|_| crate::native_message::plain("passwordPrepareFailed"))?,
        );
        platform::write(&self.target, &bytes)
    }

    pub fn prepare(
        &self,
        supplied: Secret,
        use_saved: bool,
        remember: bool,
    ) -> Result<(Secret, Option<u64>), String> {
        if !self.eligible {
            return Ok((supplied, None));
        }
        if supplied.is_empty() {
            let secret = if use_saved {
                self.read()?.unwrap_or_default()
            } else {
                supplied
            };
            return Ok((secret, None));
        }
        let epoch = self.epoch();
        let update = remember || self.read().is_ok_and(|password| password.is_some());
        Ok((supplied, update.then_some(epoch)))
    }

    pub fn replace_with(
        &self,
        password: Option<&str>,
        commit: impl FnOnce() -> Result<(), String>,
    ) -> Result<(), String> {
        let mut epochs = self.vault.epochs.lock().unwrap();
        if password.is_some() && !self.eligible {
            return Err(crate::native_message::plain("passwordPrepareFailed"));
        }
        let legacy = self.legacy_for_removal(true)?;
        let previous = platform::read(&self.target)?;
        if let Some(password) = password {
            self.write(password)?;
        } else if previous.is_some() {
            platform::delete(&self.target)?;
        }
        let remove_legacy = if let Some((key, _)) = &legacy {
            platform::delete(key)
        } else {
            Ok(())
        };
        let legacy_removed = remove_legacy.is_ok();
        if let Err(error) = remove_legacy.and_then(|()| commit()) {
            let restore_current = if let Some(previous) = previous {
                platform::write(&self.target, &previous)
            } else if password.is_some() {
                platform::delete(&self.target)
            } else {
                Ok(())
            };
            let restore_legacy = if let Some((key, bytes)) = legacy.filter(|_| legacy_removed) {
                platform::write(key, &bytes)
            } else {
                Ok(())
            };
            restore_current.and(restore_legacy)?;
            return Err(error);
        }
        *epochs.entry(self.target.clone()).or_default() += 1;
        Ok(())
    }

    pub fn forget(&self) -> Result<(), String> {
        let mut epochs = self.vault.epochs.lock().unwrap();
        *epochs.entry(self.target.clone()).or_default() += 1;
        self.clear_matching_legacy(true)?;
        platform::delete(&self.target)
    }
}

#[derive(Clone)]
pub struct VncCredential(String);
static VNC_WRITES: Mutex<()> = Mutex::new(());

impl VncCredential {
    pub fn read(&self) -> Result<Option<Zeroizing<String>>, String> {
        platform::read(&self.0)?
            .map(|bytes| {
                std::str::from_utf8(&bytes)
                    .map(|s| Zeroizing::new(s.to_owned()))
                    .map_err(|_| crate::native_message::plain("savedPasswordInvalid"))
            })
            .transpose()
    }
    pub fn save(&self, password: &str) -> Result<(), String> {
        let _guard = VNC_WRITES.lock().unwrap();
        platform::write(&self.0, password.as_bytes())
    }
    pub fn forget(&self) -> Result<(), String> {
        let _guard = VNC_WRITES.lock().unwrap();
        platform::delete(&self.0)
    }
    pub fn forget_rejected(&self, rejected: &str) -> Result<(), String> {
        let _guard = VNC_WRITES.lock().unwrap();
        if self
            .read()?
            .as_ref()
            .is_some_and(|p| p.as_str() == rejected)
        {
            platform::delete(&self.0)?;
        }
        Ok(())
    }
}

#[cfg(windows)]
mod platform {
    use super::*;
    use windows_sys::Win32::{
        Foundation::{GetLastError, ERROR_NOT_FOUND},
        Security::Credentials::*,
    };
    fn wide(value: &str) -> Vec<u16> {
        value.encode_utf16().chain(Some(0)).collect()
    }
    pub fn read(target: &str) -> Result<Option<Zeroizing<Vec<u8>>>, String> {
        let name = wide(target);
        let mut credential = std::ptr::null_mut();
        unsafe {
            if CredReadW(name.as_ptr(), CRED_TYPE_GENERIC, 0, &mut credential) == 0 {
                return if GetLastError() == ERROR_NOT_FOUND {
                    Ok(None)
                } else {
                    Err(crate::native_message::plain("windowsCredentialRead"))
                };
            }
            let value = &mut *credential;
            if value.CredentialBlobSize > CRED_MAX_CREDENTIAL_BLOB_SIZE
                || (value.CredentialBlobSize > 0 && value.CredentialBlob.is_null())
            {
                CredFree(credential.cast());
                return Err(crate::native_message::plain("savedPasswordInvalid"));
            }
            let bytes = if value.CredentialBlobSize == 0 {
                Zeroizing::new(Vec::new())
            } else {
                let blob = std::slice::from_raw_parts_mut(
                    value.CredentialBlob,
                    value.CredentialBlobSize as usize,
                );
                let copy = Zeroizing::new(blob.to_vec());
                blob.zeroize();
                copy
            };
            CredFree(credential.cast());
            Ok(Some(bytes))
        }
    }
    pub fn write(target: &str, bytes: &[u8]) -> Result<(), String> {
        if bytes.len() > CRED_MAX_CREDENTIAL_BLOB_SIZE as usize {
            return Err(crate::native_message::plain("windowsPasswordTooLong"));
        }
        let mut name = wide(target);
        let mut user = wide("OriaTunnel");
        let mut blob = Zeroizing::new(bytes.to_vec());
        let credential = CREDENTIALW {
            Type: CRED_TYPE_GENERIC,
            TargetName: name.as_mut_ptr(),
            CredentialBlobSize: blob.len() as u32,
            CredentialBlob: blob.as_mut_ptr(),
            Persist: CRED_PERSIST_LOCAL_MACHINE,
            UserName: user.as_mut_ptr(),
            ..unsafe { std::mem::zeroed() }
        };
        if unsafe { CredWriteW(&credential, 0) } == 0 {
            return Err(crate::native_message::plain("windowsCredentialSave"));
        }
        Ok(())
    }
    pub fn delete(target: &str) -> Result<(), String> {
        if unsafe { CredDeleteW(wide(target).as_ptr(), CRED_TYPE_GENERIC, 0) } == 0
            && unsafe { GetLastError() } != ERROR_NOT_FOUND
        {
            return Err(crate::native_message::plain("windowsCredentialDelete"));
        }
        Ok(())
    }
}

#[cfg(target_os = "macos")]
mod platform {
    use super::*;
    use security_framework::passwords::{
        delete_generic_password_options, generic_password, set_generic_password_options,
        PasswordOptions,
    };
    const SERVICE: &str = "com.oria-tunnel.ssh-password";
    const NOT_FOUND: i32 = -25300;

    fn options(target: &str) -> PasswordOptions {
        let mut options = PasswordOptions::new_generic_password(SERVICE, target);
        // Passwords stay on this Mac; never opt into iCloud Keychain synchronization.
        options.set_access_synchronized(Some(false));
        options
    }
    pub fn read(target: &str) -> Result<Option<Zeroizing<Vec<u8>>>, String> {
        match generic_password(options(target)) {
            Ok(bytes) => Ok(Some(Zeroizing::new(bytes))),
            Err(error) if error.code() == NOT_FOUND => Ok(None),
            Err(_) => Err(crate::native_message::plain("macCredentialRead")),
        }
    }
    pub fn write(target: &str, bytes: &[u8]) -> Result<(), String> {
        set_generic_password_options(bytes, options(target))
            .map_err(|_| crate::native_message::plain("macCredentialSave"))
    }
    pub fn delete(target: &str) -> Result<(), String> {
        match delete_generic_password_options(options(target)) {
            Ok(()) => Ok(()),
            Err(error) if error.code() == NOT_FOUND => Ok(()),
            Err(_) => Err(crate::native_message::plain("macCredentialDelete")),
        }
    }
}

pub const SUPPORTED: bool = cfg!(any(windows, target_os = "macos"));

#[cfg(all(test, any(windows, target_os = "macos")))]
mod tests {
    use super::*;
    struct Fixture {
        vault: Vault,
        host: Host,
    }
    impl Fixture {
        fn new() -> Self {
            Self {
                vault: Vault::new(
                    &std::env::temp_dir().join(format!("oria-vault-test-{}", uuid::Uuid::new_v4())),
                ),
                host: Host {
                    id: "fixture-host".into(),
                    address: "fixture.invalid".into(),
                    user: "fixture".into(),
                    auth_method: AuthMethod::Password,
                    ..Default::default()
                },
            }
        }
        fn save(&self, password: &str) {
            self.vault
                .primary(&self.host)
                .save(
                    password,
                    AuthMethod::Password,
                    self.vault.primary(&self.host).epoch(),
                )
                .unwrap();
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = self.vault.primary(&self.host).forget();
        }
    }
    #[test]
    fn only_the_original_login_claims_its_matching_legacy_password() {
        let f = Fixture::new();
        let primary = f.vault.primary(&f.host);
        let legacy_key = primary.legacy.as_deref().unwrap();
        let second = f.vault.login(&f.host, "second");
        let value = Zeroizing::new(uuid::Uuid::new_v4().to_string());
        // Seed a real v1 entry with the fixture's ephemeral secret.
        primary.save(&value, AuthMethod::Password, 0).unwrap();
        let payload = platform::read(&primary.target).unwrap().unwrap();
        platform::write(legacy_key, &payload).unwrap();
        platform::delete(&primary.target).unwrap();
        assert!(second.read().unwrap().is_none());
        let mut renamed = f.host.clone();
        renamed.user = "another-user".into();
        assert!(f.vault.primary(&renamed).read().unwrap().is_none());
        assert!(platform::read(legacy_key).unwrap().is_some());
        assert!(primary.read().unwrap().is_some_and(|s| *s == **value));
        assert!(platform::read(legacy_key).unwrap().is_none());
        let second_value = Zeroizing::new(uuid::Uuid::new_v4().to_string());
        second.save(&second_value, AuthMethod::Password, 0).unwrap();
        // Retry after interruption between publishing v2 and cleaning up v1.
        platform::write(legacy_key, &payload).unwrap();
        assert!(primary.read().unwrap().is_some_and(|s| *s == **value));
        assert!(platform::read(legacy_key).unwrap().is_none());
        primary.forget().unwrap();
        assert!(second.read().unwrap().is_some_and(|s| *s == **second_value));
        assert_eq!(second.epoch(), 0);
        second.forget().unwrap();
        platform::write(legacy_key, &payload).unwrap();
        assert!(primary
            .replace_with(Some(&second_value), || Err("fixture save failed".into()))
            .is_err());
        assert!(platform::read(&primary.target).unwrap().is_none());
        assert!(platform::read(legacy_key).unwrap().is_some());
        primary.replace_with(None, || Ok(())).unwrap();
        assert!(primary.read().unwrap().is_none());
        platform::write(legacy_key, b"invalid").unwrap();
        assert!(primary.read().is_err());
        primary
            .save(&value, AuthMethod::Password, primary.epoch())
            .unwrap();
        assert!(primary.read().unwrap().is_some());
        primary.forget().unwrap();
        assert!(platform::read(legacy_key).unwrap().is_none());
    }

    #[test]
    fn os_vault_roundtrip_is_scoped_and_clear_invalidates_pending_writes() {
        let f = Fixture::new();
        let password = Zeroizing::new(uuid::Uuid::new_v4().to_string());
        f.save(&password);
        assert!(f
            .vault
            .primary(&f.host)
            .read()
            .unwrap()
            .is_some_and(|s| *s == **password));
        let other = Fixture::new();
        assert!(other.vault.primary(&f.host).read().unwrap().is_none());
        let mut other_host = f.host.clone();
        other_host.id = "other".into();
        assert!(f.vault.primary(&other_host).read().unwrap().is_none());
        let old = f.vault.primary(&f.host).epoch();
        f.vault.primary(&f.host).forget().unwrap();
        f.vault
            .primary(&f.host)
            .save(&password, AuthMethod::Password, old)
            .unwrap();
        assert!(f.vault.primary(&f.host).read().unwrap().is_none());
        f.save(&password);
        assert!(f.vault.primary(&f.host).read().unwrap().is_some());
    }
    #[test]
    fn endpoint_changes_invalidate_credentials_but_display_changes_do_not() {
        for field in ["address", "user", "port", "auth"] {
            let f = Fixture::new();
            let password = Zeroizing::new(uuid::Uuid::new_v4().to_string());
            f.save(&password);
            let mut host = f.host.clone();
            host.name = "Renamed".into();
            host.tags = vec!["new".into()];
            assert!(f.vault.primary(&host).read().unwrap().is_some());
            match field {
                "address" => host.address = "changed.invalid".into(),
                "user" => host.user = "changed".into(),
                "port" => host.port = 2222,
                _ => host.auth_method = AuthMethod::PrivateKey,
            }
            assert!(f.vault.primary(&host).read().unwrap().is_none());
            assert!(f.vault.primary(&f.host).read().unwrap().is_none());
        }
    }
    #[test]
    fn shared_password_seeding_and_rotation_are_scoped_and_transactional() {
        let f = Fixture::new();
        let profile = LoginIdentity {
            id: uuid::Uuid::new_v4().to_string(),
            label: String::new(),
            user: f.host.user.clone(),
            auth_method: AuthMethod::Password,
            identity_files: vec![],
        };
        let entry = f.vault.credential(&profile);
        struct Cleanup<'a>(LoginPassword<'a>);
        impl Drop for Cleanup<'_> {
            fn drop(&mut self) {
                let _ = self.0.forget();
            }
        }
        let _cleanup = Cleanup(f.vault.credential(&profile));
        let old = Zeroizing::new(uuid::Uuid::new_v4().to_string());
        let new = Zeroizing::new(uuid::Uuid::new_v4().to_string());
        let mut linked = f.host.clone();
        linked.credential_ids.push(profile.id.clone());
        linked.active_login_id = Some(profile.id.clone());
        let mut second = linked.clone();
        second.id = "second-fixture".into();
        second.address = "second.invalid".into();

        let (_, update) = f
            .vault
            .primary(&linked)
            .prepare(Secret::from(new.as_str()), true, false)
            .unwrap();
        assert!(update.is_none());
        entry.replace_with(Some(&old), || Ok(())).unwrap();
        assert!(f.vault.primary(&f.host).read().unwrap().is_none());
        let (automatic, update) = f
            .vault
            .primary(&second)
            .prepare(Secret::default(), true, false)
            .unwrap();
        assert!(*automatic == **old);
        assert!(update.is_none());
        let (entered, update) = f
            .vault
            .primary(&linked)
            .prepare(Secret::from(new.as_str()), true, false)
            .unwrap();
        let update = update.unwrap();
        entry
            .save(&entered, AuthMethod::PrivateKey, update)
            .unwrap();
        assert!(entry.read().unwrap().is_some_and(|secret| *secret == **old));
        entry.save(&entered, AuthMethod::Password, update).unwrap();
        assert!(f
            .vault
            .primary(&second)
            .read()
            .unwrap()
            .is_some_and(|secret| *secret == **new));

        assert!(entry
            .replace_with(Some(&old), || Err("fixture save failed".into()))
            .is_err());
        assert!(entry.read().unwrap().is_some_and(|secret| *secret == **new));
        let mut old_host = linked.clone();
        old_host.user = "different-fixture-user".into();
        assert!(f.vault.primary(&old_host).read().unwrap().is_none());
        assert!(entry.read().unwrap().is_some_and(|secret| *secret == **new));
        entry.replace_with(None, || Ok(())).unwrap();
        entry.save(&entered, AuthMethod::Password, update).unwrap();
        assert!(entry.read().unwrap().is_none());
    }
    #[test]
    fn passphrases_empty_inputs_and_corrupt_entries_are_not_reused() {
        let f = Fixture::new();
        let value = Zeroizing::new(uuid::Uuid::new_v4().to_string());
        for method in [AuthMethod::PrivateKey, AuthMethod::Agent, AuthMethod::Auto] {
            f.vault.primary(&f.host).save(&value, method, 0).unwrap();
            assert!(f.vault.primary(&f.host).read().unwrap().is_none());
        }
        f.save("");
        assert!(f.vault.primary(&f.host).read().unwrap().is_none());
        platform::write(&f.vault.primary(&f.host).target, b"invalid").unwrap();
        assert!(f.vault.primary(&f.host).read().is_err());
        f.vault.primary(&f.host).forget().unwrap();
        assert!(f.vault.primary(&f.host).read().unwrap().is_none());
    }
}
#[cfg(not(any(windows, target_os = "macos")))]
mod platform {
    use super::*;
    pub fn read(_: &str) -> Result<Option<Zeroizing<Vec<u8>>>, String> {
        Ok(None)
    }
    pub fn write(_: &str, _: &[u8]) -> Result<(), String> {
        Err(crate::native_message::plain("passwordUnsupported"))
    }
    pub fn delete(_: &str) -> Result<(), String> {
        Err(crate::native_message::plain("passwordUnsupported"))
    }
}
