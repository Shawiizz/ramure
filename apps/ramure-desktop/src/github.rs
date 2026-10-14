//! GitHub, signed in to with its device flow: the user types a code on github.com, Ramure
//! never sees a password. The token is kept by the system's credential manager.

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

/// Ramure's OAuth application on GitHub: public by design, the device flow needs no secret.
const CLIENT_ID: &str = "Ov23lieFw0F4ruz9MC1A";
/// Reading and writing repositories, the user's name and emails, adding ssh keys.
const SCOPES: &str = "repo read:user user:email write:public_key";
const API: &str = "https://api.github.com";

fn credential() -> Result<keyring::Entry, String> {
    keyring::Entry::new("ramure", "github").map_err(|e| e.to_string())
}

fn token() -> Result<String, String> {
    credential()?.get_password().map_err(|_| "Ramure is not signed in to GitHub.".to_owned())
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder().user_agent("Ramure").build().map_err(|e| e.to_string())
}

/// A call to GitHub's API as the user signed in, its answer read as `T`.
async fn call<T: DeserializeOwned>(
    method: reqwest::Method,
    path: &str,
    body: Option<Value>,
) -> Result<T, String> {
    let mut request = client()?
        .request(method, format!("{API}{path}"))
        .bearer_auth(token()?)
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28");
    if let Some(body) = body {
        request = request.json(&body);
    }
    let response = request.send().await.map_err(|e| e.to_string())?;
    let status = response.status();
    if status.is_success() {
        return response.json().await.map_err(|e| e.to_string());
    }
    // GitHub tells what went wrong in its answer's message, and its errors' details
    let said: Value = response.json().await.unwrap_or_default();
    let details = said["errors"]
        .as_array()
        .map(|errors| errors.iter().filter_map(|e| e["message"].as_str()).collect::<Vec<_>>().join("; "))
        .filter(|d| !d.is_empty());
    let message = said["message"].as_str().unwrap_or(status.as_str());
    Err(details.map_or_else(|| message.to_owned(), |d| format!("{message}: {d}")))
}

/// The code the user types on GitHub, where, and how often to ask whether they did.
#[derive(Serialize, Deserialize)]
pub struct DeviceCode {
    device_code: String,
    user_code: String,
    verification_uri: String,
    interval: u64,
    expires_in: u64,
}

/// Starts signing in: the code to type on GitHub.
#[tauri::command]
pub async fn github_device_start() -> Result<DeviceCode, String> {
    client()?
        .post("https://github.com/login/device/code")
        .header("Accept", "application/json")
        .form(&[("client_id", CLIENT_ID), ("scope", SCOPES)])
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())
}

/// Where signing in stands: waiting for the code, asked to wait longer, or done.
#[derive(Serialize)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum Polled {
    Pending,
    SlowDown,
    Done { account: Account },
}

/// Asks GitHub once whether the code was typed; once it was, the token is kept.
#[tauri::command]
pub async fn github_device_poll(device_code: String) -> Result<Polled, String> {
    let answer: Value = client()?
        .post("https://github.com/login/oauth/access_token")
        .header("Accept", "application/json")
        .form(&[
            ("client_id", CLIENT_ID),
            ("device_code", device_code.as_str()),
            ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
        ])
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    if let Some(token) = answer["access_token"].as_str() {
        credential()?.set_password(token).map_err(|e| e.to_string())?;
        return Ok(Polled::Done {
            account: github_account().await?.ok_or("GitHub did not say who signed in.")?,
        });
    }
    match answer["error"].as_str() {
        Some("authorization_pending") => Ok(Polled::Pending),
        Some("slow_down") => Ok(Polled::SlowDown),
        Some("expired_token") => Err("The code expired: start again.".to_owned()),
        Some("access_denied") => Err("Signing in was refused on GitHub.".to_owned()),
        _ => Err(answer["error_description"].as_str().unwrap_or("GitHub refused to sign in.").to_owned()),
    }
}

/// The GitHub account signed in.
#[derive(Serialize, Deserialize)]
pub struct Account {
    login: String,
    name: Option<String>,
    avatar_url: String,
}

/// The account signed in, none when no token is kept; a token GitHub no longer takes is
/// forgotten.
#[tauri::command]
pub async fn github_account() -> Result<Option<Account>, String> {
    if token().is_err() {
        return Ok(None);
    }
    match call::<Account>(reqwest::Method::GET, "/user", None).await {
        Ok(account) => Ok(Some(account)),
        Err(e) if e.contains("Bad credentials") => {
            github_sign_out().await?;
            Ok(None)
        }
        Err(e) => Err(e),
    }
}

#[tauri::command]
pub async fn github_sign_out() -> Result<(), String> {
    match credential()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

/// A repository of the user's, or one they work on.
#[derive(Serialize, Deserialize)]
pub struct Repository {
    full_name: String,
    description: Option<String>,
    private: bool,
    clone_url: String,
    ssh_url: String,
    pushed_at: Option<String>,
}

/// The repositories the user owns or works on, the last pushed to first.
#[tauri::command]
pub async fn github_repositories() -> Result<Vec<Repository>, String> {
    let mut all = Vec::new();
    for page in 1..=5 {
        let path = format!("/user/repos?per_page=100&sort=pushed&page={page}");
        let found: Vec<Repository> = call(reqwest::Method::GET, &path, None).await?;
        let last = found.len() < 100;
        all.extend(found);
        if last {
            break;
        }
    }
    Ok(all)
}

/// A pull request, as the sidebar lists it.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Pull {
    number: u64,
    title: String,
    author: String,
    draft: bool,
    url: String,
    /// The branch it brings, and the repository holding it (a fork's, maybe).
    head: String,
    head_repository: Option<String>,
    /// The commit it brings last.
    head_id: String,
    base: String,
    /// The base branch's last commit.
    base_id: String,
}

impl Pull {
    fn from(pull: &Value) -> Pull {
        let text = |value: &Value| value.as_str().unwrap_or_default().to_owned();
        Pull {
            number: pull["number"].as_u64().unwrap_or_default(),
            title: text(&pull["title"]),
            author: text(&pull["user"]["login"]),
            draft: pull["draft"].as_bool().unwrap_or(false),
            url: text(&pull["html_url"]),
            head: text(&pull["head"]["ref"]),
            head_repository: pull["head"]["repo"]["full_name"].as_str().map(str::to_owned),
            head_id: text(&pull["head"]["sha"]),
            base: text(&pull["base"]["ref"]),
            base_id: text(&pull["base"]["sha"]),
        }
    }
}

/// The open pull requests of `owner/repository`, the last updated first: at most 500.
#[tauri::command]
pub async fn github_pulls(repository: String) -> Result<Vec<Pull>, String> {
    let mut all = Vec::new();
    for page in 1..=5 {
        let path = format!(
            "/repos/{repository}/pulls?state=open&sort=updated&direction=desc&per_page=100&page={page}"
        );
        let pulls: Vec<Value> = call(reqwest::Method::GET, &path, None).await?;
        all.extend(pulls.iter().map(Pull::from));
        if pulls.len() < 100 {
            break;
        }
    }
    Ok(all)
}

/// Where a check on a commit stands.
#[derive(Serialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum CheckState {
    Success,
    Failure,
    Pending,
    /// Skipped, cancelled or neutral: it neither passed nor failed.
    Neutral,
}

/// A check run on a commit (GitHub Actions and the like), or a status another service set.
#[derive(Serialize)]
pub struct Check {
    name: String,
    state: CheckState,
    url: Option<String>,
}

/// The checks on the commits `ids` of `owner/repository`, by commit: those with none left
/// out. Their two kinds are asked for every commit at once.
#[tauri::command]
pub async fn github_checks(
    repository: String,
    ids: Vec<String>,
) -> Result<std::collections::BTreeMap<String, Vec<Check>>, String> {
    let asked: Vec<_> = ids
        .into_iter()
        .map(|id| {
            let repository = repository.clone();
            tauri::async_runtime::spawn(async move {
                let checks = checks_of(&repository, &id).await;
                (id, checks)
            })
        })
        .collect();
    let mut found = std::collections::BTreeMap::new();
    for task in asked {
        // a commit GitHub does not have yet (one not pushed) has no checks
        if let (id, Ok(checks)) = task.await.map_err(|e| e.to_string())? {
            if !checks.is_empty() {
                found.insert(id, checks);
            }
        }
    }
    Ok(found)
}

async fn checks_of(repository: &str, id: &str) -> Result<Vec<Check>, String> {
    let text = |value: &Value| value.as_str().map(str::to_owned);
    let runs: Value = call(
        reqwest::Method::GET,
        &format!("/repos/{repository}/commits/{id}/check-runs?per_page=100"),
        None,
    )
    .await?;
    let mut checks: Vec<Check> = runs["check_runs"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|run| Check {
            name: text(&run["name"]).unwrap_or_default(),
            state: match (run["status"].as_str(), run["conclusion"].as_str()) {
                (Some("completed"), Some("success")) => CheckState::Success,
                (
                    Some("completed"),
                    Some("failure" | "timed_out" | "action_required" | "startup_failure"),
                ) => CheckState::Failure,
                (Some("completed"), _) => CheckState::Neutral,
                _ => CheckState::Pending,
            },
            url: text(&run["html_url"]),
        })
        .collect();
    let statuses: Value =
        call(reqwest::Method::GET, &format!("/repos/{repository}/commits/{id}/status"), None).await?;
    checks.extend(statuses["statuses"].as_array().into_iter().flatten().map(|status| Check {
        name: text(&status["context"]).unwrap_or_default(),
        state: match status["state"].as_str() {
            Some("success") => CheckState::Success,
            Some("failure" | "error") => CheckState::Failure,
            _ => CheckState::Pending,
        },
        url: text(&status["target_url"]),
    }));
    Ok(checks)
}

/// A pull request read whole: what it says, and what was said about it.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PullThread {
    #[serde(flatten)]
    pull: Pull,
    body: String,
    avatar: Option<String>,
    /// `open` or `closed`; merged when closed by a merge.
    state: String,
    merged: bool,
    created_at: String,
    notes: Vec<Note>,
}

/// Something said about a pull request: a comment, a review, or a comment on a line of
/// its code.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    kind: &'static str,
    author: String,
    avatar: Option<String>,
    body: String,
    time: String,
    /// A review's verdict: `APPROVED`, `CHANGES_REQUESTED`, `COMMENTED`, `DISMISSED`.
    state: Option<String>,
    /// The file and line a comment on the code is about.
    path: Option<String>,
    line: Option<u64>,
    url: Option<String>,
}

impl Note {
    fn from(kind: &'static str, value: &Value, time: &str) -> Note {
        let text = |value: &Value| value.as_str().map(str::to_owned);
        Note {
            kind,
            author: text(&value["user"]["login"]).unwrap_or_default(),
            avatar: text(&value["user"]["avatar_url"]),
            body: text(&value["body"]).unwrap_or_default(),
            time: text(&value[time]).unwrap_or_default(),
            state: text(&value["state"]),
            path: text(&value["path"]),
            line: value["line"].as_u64().or_else(|| value["original_line"].as_u64()),
            url: text(&value["html_url"]),
        }
    }
}

/// The pull request `number` of `owner/repository`: its description, its comments, its
/// reviews and the comments on its code, in the order they were made.
#[tauri::command]
pub async fn github_pull(repository: String, number: u64) -> Result<PullThread, String> {
    let get = |path: String| {
        tauri::async_runtime::spawn(async move { call::<Value>(reqwest::Method::GET, &path, None).await })
    };
    let pull = get(format!("/repos/{repository}/pulls/{number}"));
    let comments = get(format!("/repos/{repository}/issues/{number}/comments?per_page=100"));
    let reviews = get(format!("/repos/{repository}/pulls/{number}/reviews?per_page=100"));
    let on_code = get(format!("/repos/{repository}/pulls/{number}/comments?per_page=100"));
    let joined = |e: tauri::Error| e.to_string();
    let pull = pull.await.map_err(joined)??;
    let list = |value: Value| value.as_array().cloned().unwrap_or_default();
    let mut notes: Vec<Note> = list(comments.await.map_err(joined)??)
        .iter()
        .map(|c| Note::from("comment", c, "created_at"))
        .collect();
    notes.extend(
        list(reviews.await.map_err(joined)??)
            .iter()
            .map(|r| Note::from("review", r, "submitted_at"))
            // a review that only holds comments on the code says nothing of its own
            .filter(|r| !(r.body.is_empty() && r.state.as_deref() == Some("COMMENTED"))),
    );
    notes.extend(list(on_code.await.map_err(joined)??).iter().map(|c| Note::from("code", c, "created_at")));
    notes.sort_by(|a, b| a.time.cmp(&b.time));
    let text = |value: &Value| value.as_str().unwrap_or_default().to_owned();
    Ok(PullThread {
        body: text(&pull["body"]),
        avatar: pull["user"]["avatar_url"].as_str().map(str::to_owned),
        state: text(&pull["state"]),
        merged: pull["merged"].as_bool().unwrap_or(false),
        created_at: text(&pull["created_at"]),
        pull: Pull::from(&pull),
        notes,
    })
}

/// Comments on the pull request `number` of `owner/repository`.
#[tauri::command]
pub async fn github_comment(repository: String, number: u64, body: String) -> Result<(), String> {
    let path = format!("/repos/{repository}/issues/{number}/comments");
    call::<Value>(reqwest::Method::POST, &path, Some(json!({ "body": body }))).await.map(drop)
}

/// Reviews the pull request `number` of `owner/repository`: `APPROVE`, `REQUEST_CHANGES`
/// or `COMMENT`, with `body` said along.
#[tauri::command]
pub async fn github_review(
    repository: String,
    number: u64,
    event: String,
    body: String,
) -> Result<(), String> {
    if !["APPROVE", "REQUEST_CHANGES", "COMMENT"].contains(&event.as_str()) {
        return Err(format!("{event} is not a review"));
    }
    let path = format!("/repos/{repository}/pulls/{number}/reviews");
    call::<Value>(reqwest::Method::POST, &path, Some(json!({ "event": event, "body": body }))).await.map(drop)
}

/// A new pull request on `owner/repository`, bringing `head` into `base`.
#[tauri::command]
pub async fn github_create_pull(
    repository: String,
    title: String,
    body: String,
    head: String,
    base: String,
    draft: bool,
) -> Result<Pull, String> {
    let body = json!({ "title": title, "body": body, "head": head, "base": base, "draft": draft });
    let pull: Value = call(reqwest::Method::POST, &format!("/repos/{repository}/pulls"), Some(body)).await?;
    Ok(Pull::from(&pull))
}

/// The default branch of `owner/repository`, which pull requests go into unless told.
#[tauri::command]
pub async fn github_default_branch(repository: String) -> Result<String, String> {
    let found: Value = call(reqwest::Method::GET, &format!("/repos/{repository}"), None).await?;
    Ok(found["default_branch"].as_str().unwrap_or("main").to_owned())
}

/// Adds the public ssh key `key` to the account, under `title`.
#[tauri::command]
pub async fn github_add_ssh_key(title: String, key: String) -> Result<(), String> {
    call::<Value>(reqwest::Method::POST, "/user/keys", Some(json!({ "title": title, "key": key })))
        .await
        .map(drop)
}

/// The pictures of the people who made the last commits of `owner/repository`, by their
/// email in lower case: those GitHub knows the account of.
#[tauri::command]
pub async fn github_avatars(
    repository: String,
) -> Result<std::collections::BTreeMap<String, String>, String> {
    let mut pictures = std::collections::BTreeMap::new();
    for page in 1..=3 {
        let path = format!("/repos/{repository}/commits?per_page=100&page={page}");
        let commits: Vec<Value> = call(reqwest::Method::GET, &path, None).await?;
        for commit in &commits {
            for role in ["author", "committer"] {
                let email = commit["commit"][role]["email"].as_str();
                let picture = commit[role]["avatar_url"].as_str();
                if let (Some(email), Some(picture)) = (email, picture) {
                    pictures.entry(email.to_lowercase()).or_insert_with(|| picture.to_owned());
                }
            }
        }
        if commits.len() < 100 {
            break;
        }
    }
    Ok(pictures)
}
