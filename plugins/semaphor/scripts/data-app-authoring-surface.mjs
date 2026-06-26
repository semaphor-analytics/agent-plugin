export const CANONICAL_DATA_APP_AUTHORING_TOOLS = Object.freeze([
  "semaphor_get_access_context",
  "semaphor_get_data_app_sdk_guidance",
  "semaphor_plan_data_app",
  "semaphor_plan_data_app_change",
  "semaphor_create_data_app_contract",
  "semaphor_generate_data_app_contract",
  "semaphor_update_data_app_contract",
  "semaphor_materialize_data_app_contract",
  "semaphor_validate_data_app_contract",
  "semaphor_inspect_data_app_state",
  "semaphor_propose_semantic_model_change",
  "semaphor_apply_semantic_model_patch",
]);

export const DATA_APP_AUTHORING_BOOTSTRAP_TOOL_DEFINITIONS = Object.freeze([
  {
    name: "semaphor_get_access_context",
    description:
      "Diagnose Semaphor auth setup. If no token is configured, pause data-bearing app work and ask the user to use the current host MCP OAuth login flow for the semaphor server, or add VITE_SEMAPHOR_PROJECT_TOKEN to the target React app .env.local, then resume when they say try again. In Codex, the OAuth command is codex mcp login semaphor. Do not scaffold placeholder analytics when auth is unavailable.",
  },
  {
    name: "semaphor_get_data_app_sdk_guidance",
    description:
      "Fetch Semaphor Data App SDK guidance. In installed bridge runs, pass workspaceDir so the bridge can resolve target-app project-token auth before forwarding to Semaphor.",
  },
  {
    name: "semaphor_plan_data_app",
    description:
      "Plan a new governed Semaphor Data App and return a planArtifactId. In installed bridge runs, pass workspaceDir so target-app project-token auth can be resolved before forwarding to Semaphor.",
  },
  {
    name: "semaphor_plan_data_app_change",
    description:
      "Plan an analytical change for an existing generated Semaphor Data App. In installed bridge runs, pass workspaceDir; the bridge inspects and validates local src/semaphor/generated files, then forwards currentManifest and beforeCurrentAuthoringState.",
  },
  {
    name: "semaphor_create_data_app_contract",
    description:
      "Create a governed Data App contract in one server-owned call. In installed bridge runs, workspaceDir may be used only as a bridge-local auth hint and is stripped before forwarding; local files are written by semaphor_materialize_data_app_contract.",
  },
  {
    name: "semaphor_generate_data_app_contract",
    description:
      "Generate a governed Data App contract from a greenfield planArtifactId. Returns a generatedContractArtifactId and materialization token; local files are written by semaphor_materialize_data_app_contract.",
  },
  {
    name: "semaphor_update_data_app_contract",
    description:
      "Generate an updated governed Data App contract from a change planArtifactId. Returns a generatedContractArtifactId and materialization token; local files are written by semaphor_materialize_data_app_contract.",
  },
  {
    name: "semaphor_materialize_data_app_contract",
    description:
      "Materialize a generated Data App contract artifact into local src/semaphor/generated files. In installed bridge runs, pass generatedContractArtifactId, generatedContractMaterializationToken, and workspaceDir.",
  },
  {
    name: "semaphor_validate_data_app_contract",
    description:
      "Validate generated Data App contract files. In installed bridge runs, pass workspaceDir to read local src/semaphor/generated without hand-assembling manifest or generatedFiles payloads.",
  },
  {
    name: "semaphor_inspect_data_app_state",
    description:
      "Inspect and validate local generated Data App authoring state before iterative edits. In installed bridge runs, pass workspaceDir.",
  },
  {
    name: "semaphor_propose_semantic_model_change",
    description:
      "Propose a server-owned semantic-model repair for a missing relationship or Data App modeling gap. In installed bridge runs, pass workspaceDir so the bridge can resolve target-app project-token auth before forwarding to Semaphor.",
  },
  {
    name: "semaphor_apply_semantic_model_patch",
    description:
      "Apply an explicitly user-approved server-owned semantic-model repair patch. In installed bridge runs, pass workspaceDir so the bridge can resolve target-app project-token auth before forwarding to Semaphor.",
  },
]);

export function assertCanonicalDataAppAuthoringDefinitions(definitions) {
  const names = definitions.map((definition) => definition.name);
  const expected = CANONICAL_DATA_APP_AUTHORING_TOOLS;
  if (JSON.stringify(names) !== JSON.stringify(expected)) {
    throw new Error(
      `Data App authoring bootstrap tools must match the canonical order. Expected ${expected.join(", ")}; got ${names.join(", ")}.`,
    );
  }
}
