import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import { makeT } from "./test.kit";
import { asUser, insertUser } from "./test.helpers";

async function seedProject(t: ReturnType<typeof makeT>) {
  const comId = await insertUser(t, { role: "commercial" });
  const leadId = await t.run((ctx) => ctx.db.insert("leads", { source: "manual", status: "signe" }));
  const projectId = await t.run((ctx) => ctx.db.insert("projects", { leadId, commercialId: comId, name: "P", status: "signe" }));
  return { comId, projectId };
}

async function storedBlob(t: ReturnType<typeof makeT>) {
  return await t.run((ctx) => ctx.storage.store(new Blob(["fake-image-bytes"])));
}

describe("projectAttachments", () => {
  it("upload → list → getUrl (photo), soft-delete", async () => {
    const t = makeT();
    const { comId, projectId } = await seedProject(t);
    const storageId = await storedBlob(t);
    const created = await asUser(t, comId).mutation(api.projectAttachments.create, {
      projectId, kind: "photo", label: "Toiture", filename: "toit.jpg", contentType: "image/jpeg", sizeBytes: 16, storageId,
    });
    expect(created).toMatchObject({ kind: "photo", filename: "toit.jpg", label: "Toiture" });

    const list = await asUser(t, comId).query(api.projectAttachments.listByProject, { projectId });
    expect(list).toHaveLength(1);
    const url = await asUser(t, comId).query(api.projectAttachments.getUrl, { attachmentId: created.id });
    expect(url?.filename).toBe("toit.jpg");

    await asUser(t, comId).mutation(api.projectAttachments.remove, { attachmentId: created.id });
    expect(await asUser(t, comId).query(api.projectAttachments.listByProject, { projectId })).toHaveLength(0);
    expect(await asUser(t, comId).query(api.projectAttachments.getUrl, { attachmentId: created.id })).toBeNull();
  });

  it("kind invalide → throw ; setter peut lire mais pas uploader", async () => {
    const t = makeT();
    const { comId, projectId } = await seedProject(t);
    const storageId = await storedBlob(t);
    await expect(asUser(t, comId).mutation(api.projectAttachments.create, {
      projectId, kind: "video", filename: "x", contentType: "y", sizeBytes: 1, storageId,
    })).rejects.toThrow();

    const setterId = await insertUser(t, { role: "setter" });
    // setter : lecture autorisée, upload refusé
    expect(await asUser(t, setterId).query(api.projectAttachments.listByProject, { projectId })).toEqual([]);
    const sid2 = await storedBlob(t);
    await expect(asUser(t, setterId).mutation(api.projectAttachments.create, {
      projectId, kind: "document", filename: "x", contentType: "y", sizeBytes: 1, storageId: sid2,
    })).rejects.toThrow();
  });
});
