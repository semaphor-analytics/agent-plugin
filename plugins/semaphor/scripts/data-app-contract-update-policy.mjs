import { importSharedCodegen } from "./data-app-codegen-summary-validation.mjs";

export async function evaluateContractUpdatePolicy(input, options = {}) {
  const sharedCodegen = await importSharedCodegen(options);
  const evaluator =
    sharedCodegen.evaluateSemaphorDataAppContractUpdatePolicy;
  if (typeof evaluator !== "function") {
    throw new Error(
      "react-semaphor/data-app-codegen/node does not expose evaluateSemaphorDataAppContractUpdatePolicy.",
    );
  }
  return evaluator(input);
}
