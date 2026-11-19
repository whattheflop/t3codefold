import { assert, describe, it } from "@effect/vitest";

import { codexPermissionApprovalPrompt } from "./CodexAdapterV2Fold.ts";

describe("CodexAdapterV2 permission approvals", () => {
  it("prefers a nonblank reason, else names the requested paths", () => {
    const permissions = {
      fileSystem: { read: ["/workspace/notes.md"], write: ["/workspace/out"] },
    };
    assert.equal(
      codexPermissionApprovalPrompt({ reason: " Read notes. ", permissions }),
      "Read notes.",
    );
    assert.equal(
      codexPermissionApprovalPrompt({ reason: null, permissions }),
      "Access: /workspace/notes.md, /workspace/out",
    );
    assert.isUndefined(codexPermissionApprovalPrompt({ reason: " ", permissions: {} }));
  });
});
