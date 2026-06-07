# Onboarding And Auth Preflight

Use this before building, planning, answering business questions, or publishing
when the user has not already named a Semaphor project and local app context.

## Mental Model

Separate three decisions:

```text
1. Who are you?          -> Semaphor auth
2. Which data?           -> Semaphor project
3. Which domain?         -> semantic domain in the selected project
4. Where should I code?  -> existing React app or starter app
```

Do not make the user understand MCP transport. Choose the lowest-friction path
based on what is already configured.

## First-Run Flow

1. Check Semaphor auth first.
   - Call `semaphor_get_access_context` before reading local package files,
     inspecting source, searching SDK declarations, or running helper scripts.
   - If the host exposes the OAuth MCP server `semaphor`, use it as the
     first-run path when no project token is already active.
   - If a project token is already active, the project-token MCP server
     `semaphor-project` can report the fixed project scope.
   - If neither OAuth nor a project token is available, or if OAuth says the
     app connection requires reauthentication, ask the user to run
     `codex mcp login semaphor` or add a project token from
     `https://semaphor.cloud/project`, then say "try again". Treat this as a
     resumable setup step, not as a refusal.

2. Resolve project context.
   - Project-token mode: the token fixes the active project. Do not list
     projects unless the tool reports interactive mode.
   - OAuth mode: call `semaphor_list_projects`, ask the user which project to
     use, then pass `projectId` to project-scoped tools.
   - If OAuth mode is being used and the local React app must run Semaphor
     queries in the browser, call `semaphor_get_data_app_runtime_token` for the
     chosen project and write `VITE_SEMAPHOR_PROJECT_TOKEN` to the app's
     ignored `.env.local`. Do not print the token.

3. Resolve domain context for broad app requests.
   - Call `semaphor_get_analysis_context` and
     `semaphor_list_semantic_domains` for the selected project.
   - If the user named a domain/source, use it.
   - If there is one usable domain, state the assumption and continue.
   - If there are multiple usable domains and the user did not name one, ask
     the user to choose the domain before planning.
   - If the goal clearly implies one domain, recommend it but still ask for
     confirmation before calling `semaphor_plan_data_app`.

4. Inspect the current workspace.
   - If it is a React app, use it by default.
   - If it is not a React app, ask whether to start from
     `semaphor-analytics/semaphor-data-app-starter`.

5. Plan before broad codegen.
   - Use `semaphor_plan_data_app` for broad new apps.
   - Use `semaphor_plan_data_app_change` for substantial edits.

6. Build, validate, and save/publish only when requested or clearly implied.

## OAuth Path

OAuth is the least-friction login path when no project token exists.

In Codex, the hosted OAuth MCP server is named `semaphor`. If the host does
not show it as authenticated, or if a tool reports that the app connection
requires reauthentication, ask the user to run:

```bash
codex mcp login semaphor
```

Then wait for the user to say "try again". If the host needs a fresh session
before refreshed OAuth tools appear, say that explicitly.

After OAuth login, start with:

```text
semaphor_get_access_context
semaphor_list_projects
```

Then ask the user to choose the project unless there is an explicit project in
the user request.

OAuth is for agent authoring and discovery. It is not automatically the React
app runtime credential. When local runtime needs a token, use
`semaphor_get_data_app_runtime_token`; never write the MCP OAuth access token
to app source or env files.

## Project Token Path

Project-token mode remains the deterministic path for local app development,
validation, save, and publish.

In the plugin MCP config, the project-token bridge is named
`semaphor-project`. Use it only when a project token is already configured or
the user explicitly provides one.

Use it when the app has:

```bash
VITE_SEMAPHOR_PROJECT_TOKEN="<project-token>"
```

or:

```bash
SEMAPHOR_PROJECT_TOKEN="<project-token>"
```

Do not print or inspect token values. Detect variable names only.

## Starter App Path

Use the current React app if one exists. Do not replace it with the starter.

Use the public starter only when:

- the current folder is not a React app;
- the user explicitly asks to start fresh;
- the user approves creating a new local app.

Starter repo:

```text
https://github.com/semaphor-analytics/semaphor-data-app-starter
```

"Start a new local app" means use the starter. "Create a new Semaphor project"
is different and requires an explicit Semaphor project-creation capability.
Do not imply the plugin can create Semaphor data projects unless a first-class
MCP tool for that is available.

## Runtime Auth

OAuth lets the agent inspect and plan with Semaphor. Local React runtime still
needs a project-scoped runtime credential or hosted Semaphor runtime auth.

If the agent used OAuth and the generated local app needs to run queries in the
browser, mint a scoped runtime token through MCP:

```text
semaphor_get_data_app_runtime_token({ projectId })
```

Then write the returned structured-content token to:

```bash
VITE_SEMAPHOR_PROJECT_TOKEN="<minted-runtime-token>"
```

Rules:

- Write the token only to an ignored local env file such as `.env.local`.
- Do not print the token in chat, terminal output, markdown, source files,
  manifests, screenshots, or logs.
- If the app later reports an expired or invalid project token, call
  `semaphor_get_data_app_runtime_token` again through the OAuth server and
  replace the env value.
- Do not hardcode OAuth access tokens into app source or `.env.local`.
