import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";
import { roleValidator, teamValidator } from "./model/enums";

export default defineSchema({
  ...authTables,

  users: defineTable({
    // —— identité (écrite par Convex Auth) ——
    email: v.optional(v.string()),
    emailVerified: v.optional(v.boolean()),
    name: v.optional(v.string()),
    image: v.optional(v.string()),
    phone: v.optional(v.string()),
    isAnonymous: v.optional(v.boolean()),
    // —— métier ——
    externalId: v.optional(v.string()),
    role: v.optional(roleValidator), // défaut "setter" appliqué via roleOf() — jamais écrit au login
    team: v.optional(teamValidator),
    active: v.optional(v.boolean()),
    ghlUserId: v.optional(v.string()),
    ghlCalendarId: v.optional(v.string()),
    ghlLocationId: v.optional(v.string()),
    lastSeenAt: v.optional(v.number()),
    lastLoginAt: v.optional(v.number()),
    lastActionAt: v.optional(v.number()),
    lastActionType: v.optional(v.string()),
    createdById: v.optional(v.id("users")),
    deletedAt: v.optional(v.number()),
  })
    .index("by_email", ["email"])
    .index("by_externalId", ["externalId"])
    .index("by_ghlUserId", ["ghlUserId"])
    .index("by_role", ["role"]),

  referrers: defineTable({
    nom: v.string(),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    notes: v.optional(v.string()),
    active: v.boolean(),
    externalId: v.optional(v.string()),
  })
    .index("by_externalId", ["externalId"])
    .index("by_active", ["active"]),
});
