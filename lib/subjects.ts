import "server-only";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { getAsset } from "@/lib/repository";

export type SubjectType = "person" | "product";

export type StoredSubjectCard = {
  id: string;
  name: string;
  subjectType: SubjectType;
  description: string;
  usageNotes: string;
  primaryAssetId: string;
  assetIds: string[];
  createdAt: string;
  updatedAt: string;
};

function parseIds(value: string | null | undefined) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed.filter(item => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function rowToCard(row: any): StoredSubjectCard {
  return {
    id: row.id,
    name: row.name,
    subjectType: row.subject_type,
    description: row.description || "",
    usageNotes: row.usage_notes || "",
    primaryAssetId: row.primary_asset_id,
    assetIds: parseIds(row.asset_ids_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function assertImageAssets(assetIds: string[]) {
  const unique = [...new Set(assetIds)];
  if (unique.length < 1 || unique.length > 5) throw new Error("主体卡需要 1–5 张参考图片");
  for (const id of unique) {
    const asset = getAsset(id);
    if (!asset) throw new Error("主体卡引用了不存在的素材，请重新选择");
    if (asset.mediaType !== "image") throw new Error(`主体卡当前只接受图片素材：“${asset.name}”不是图片`);
  }
  return unique;
}

export function createSubjectCard(input: {
  name: string;
  subjectType: SubjectType;
  description?: string;
  usageNotes?: string;
  primaryAssetId: string;
  assetIds: string[];
}) {
  const assetIds = assertImageAssets(input.assetIds);
  if (!assetIds.includes(input.primaryAssetId)) throw new Error("主参考图必须属于这张主体卡的参考图片");
  const now = new Date().toISOString();
  const id = randomUUID();
  db.prepare(`INSERT INTO subject_cards
    (id, name, subject_type, description, usage_notes, primary_asset_id, asset_ids_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, input.name.trim(), input.subjectType, input.description?.trim() || "", input.usageNotes?.trim() || "", input.primaryAssetId, JSON.stringify(assetIds), now, now);
  return getSubjectCard(id)!;
}

export function updateSubjectCard(id: string, input: {
  name: string;
  subjectType: SubjectType;
  description?: string;
  usageNotes?: string;
  primaryAssetId: string;
  assetIds: string[];
}) {
  if (!getSubjectCard(id)) throw new Error("主体卡不存在");
  const assetIds = assertImageAssets(input.assetIds);
  if (!assetIds.includes(input.primaryAssetId)) throw new Error("主参考图必须属于这张主体卡的参考图片");
  db.prepare(`UPDATE subject_cards SET name=?, subject_type=?, description=?, usage_notes=?, primary_asset_id=?, asset_ids_json=?, updated_at=? WHERE id=?`)
    .run(input.name.trim(), input.subjectType, input.description?.trim() || "", input.usageNotes?.trim() || "", input.primaryAssetId, JSON.stringify(assetIds), new Date().toISOString(), id);
  return getSubjectCard(id)!;
}

export function getSubjectCard(id: string): StoredSubjectCard | null {
  const row = db.prepare("SELECT * FROM subject_cards WHERE id=?").get(id);
  return row ? rowToCard(row) : null;
}

export function listSubjectCards(): StoredSubjectCard[] {
  return (db.prepare("SELECT * FROM subject_cards ORDER BY updated_at DESC").all() as any[]).map(rowToCard);
}

export function deleteSubjectCard(id: string) {
  return db.prepare("DELETE FROM subject_cards WHERE id=?").run(id).changes > 0;
}

export function publicSubjectCards() {
  return listSubjectCards().map(card => {
    const assets = card.assetIds.map(id => getAsset(id)).filter(Boolean);
    const primaryAsset = getAsset(card.primaryAssetId) || assets[0] || null;
    return {
      ...card,
      primaryAssetId: primaryAsset?.id || card.primaryAssetId,
      assets,
      primaryAsset,
      missingAssetCount: card.assetIds.length - assets.length,
    };
  });
}

/** Remove a deleted asset from subject cards instead of leaving silently broken identities. */
export function detachAssetFromSubjectCards(assetId: string) {
  const transaction = db.transaction(() => {
    for (const card of listSubjectCards()) {
      if (!card.assetIds.includes(assetId)) continue;
      const nextIds = card.assetIds.filter(id => id !== assetId);
      if (!nextIds.length) {
        deleteSubjectCard(card.id);
        continue;
      }
      const nextPrimary = card.primaryAssetId === assetId ? nextIds[0] : card.primaryAssetId;
      db.prepare("UPDATE subject_cards SET primary_asset_id=?, asset_ids_json=?, updated_at=? WHERE id=?")
        .run(nextPrimary, JSON.stringify(nextIds), new Date().toISOString(), card.id);
    }
  });
  transaction();
}
