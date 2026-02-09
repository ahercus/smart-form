import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!user.is_anonymous) {
    return NextResponse.json(
      { error: "Seed is only available for anonymous users" },
      { status: 403 }
    );
  }

  const userId = user.id;
  const adminClient = createAdminClient();

  try {
    // Idempotency: skip if profile already exists
    const { data: existingProfile } = await adminClient
      .from("profiles")
      .select("user_id")
      .eq("user_id", userId)
      .single();

    if (existingProfile) {
      return NextResponse.json({ status: "already_seeded" });
    }

    console.log("[AutoForm] Seeding anonymous guest data for user:", userId);

    const placeholderEmail = `anonymous-${userId.slice(0, 8)}@guest.local`;

    // 1. Insert profile
    const { error: profileError } = await adminClient
      .from("profiles")
      .upsert(
        {
          user_id: userId,
          email: placeholderEmail,
          core_data: {
            firstName: "Alex",
            middleInitial: "J",
            lastName: "Thompson",
            email: "alex.thompson@email.com",
            phone: "(415) 555-0142",
            dateOfBirth: "1990-03-15",
            address: {
              street: "742 Evergreen Terrace",
              city: "San Francisco",
              state: "CA",
              zip: "94102",
              country: "United States",
            },
          },
          extended_context:
            "Software engineer at TechFlow Inc. Married to Jordan Thompson. One daughter, Maya (age 7). Lives in San Francisco.",
          subscription_tier: "free",
        },
        { onConflict: "user_id" }
      );

    if (profileError)
      throw new Error(`Failed to seed profile: ${profileError.message}`);

    // 2. Insert entities
    const entities = [
      {
        user_id: userId,
        entity_type: "person",
        canonical_name: "Alex Thompson",
        relationship_to_user: "self",
        confidence: 1.0,
        access_count: 12,
      },
      {
        user_id: userId,
        entity_type: "person",
        canonical_name: "Jordan Thompson",
        relationship_to_user: "spouse",
        confidence: 0.95,
        access_count: 8,
      },
      {
        user_id: userId,
        entity_type: "person",
        canonical_name: "Maya Thompson",
        relationship_to_user: "daughter",
        confidence: 0.9,
        access_count: 5,
      },
      {
        user_id: userId,
        entity_type: "organization",
        canonical_name: "TechFlow Inc",
        relationship_to_user: "employer",
        confidence: 0.95,
        access_count: 6,
      },
      {
        user_id: userId,
        entity_type: "person",
        canonical_name: "Dr. Sarah Chen",
        relationship_to_user: "primary care physician",
        confidence: 0.85,
        access_count: 3,
      },
    ];

    const { data: insertedEntities, error: entitiesError } = await adminClient
      .from("entities")
      .insert(entities)
      .select("id, canonical_name");

    if (entitiesError)
      throw new Error(`Failed to seed entities: ${entitiesError.message}`);

    const entityMap = new Map(
      insertedEntities.map((e) => [e.canonical_name, e.id])
    );

    // 3. Insert entity facts
    const alexId = entityMap.get("Alex Thompson")!;
    const jordanId = entityMap.get("Jordan Thompson")!;
    const mayaId = entityMap.get("Maya Thompson")!;
    const techflowId = entityMap.get("TechFlow Inc")!;
    const drChenId = entityMap.get("Dr. Sarah Chen")!;

    const facts = [
      // Alex (self)
      { entity_id: alexId, fact_type: "full_name", fact_value: "Alex James Thompson", confidence: 1.0 },
      { entity_id: alexId, fact_type: "email", fact_value: "alex.thompson@email.com", confidence: 1.0 },
      { entity_id: alexId, fact_type: "phone", fact_value: "(415) 555-0142", confidence: 1.0 },
      { entity_id: alexId, fact_type: "birthdate", fact_value: "1990-03-15", confidence: 1.0 },
      { entity_id: alexId, fact_type: "gender", fact_value: "Male", confidence: 0.95 },
      { entity_id: alexId, fact_type: "occupation", fact_value: "Software Engineer", confidence: 0.95 },
      { entity_id: alexId, fact_type: "employer", fact_value: "TechFlow Inc", confidence: 0.95 },
      { entity_id: alexId, fact_type: "street", fact_value: "742 Evergreen Terrace", confidence: 1.0 },
      { entity_id: alexId, fact_type: "city", fact_value: "San Francisco", confidence: 1.0 },
      { entity_id: alexId, fact_type: "state", fact_value: "CA", confidence: 1.0 },
      { entity_id: alexId, fact_type: "zip", fact_value: "94102", confidence: 1.0 },
      { entity_id: alexId, fact_type: "ssn_last4", fact_value: "4829", confidence: 0.9 },
      // Jordan (spouse)
      { entity_id: jordanId, fact_type: "full_name", fact_value: "Jordan Marie Thompson", confidence: 0.95 },
      { entity_id: jordanId, fact_type: "email", fact_value: "jordan.thompson@email.com", confidence: 0.9 },
      { entity_id: jordanId, fact_type: "phone", fact_value: "(415) 555-0198", confidence: 0.9 },
      { entity_id: jordanId, fact_type: "birthdate", fact_value: "1991-07-22", confidence: 0.9 },
      { entity_id: jordanId, fact_type: "gender", fact_value: "Female", confidence: 0.95 },
      { entity_id: jordanId, fact_type: "occupation", fact_value: "Product Designer", confidence: 0.85 },
      // Maya (daughter)
      { entity_id: mayaId, fact_type: "full_name", fact_value: "Maya Rose Thompson", confidence: 0.9 },
      { entity_id: mayaId, fact_type: "birthdate", fact_value: "2018-11-03", confidence: 0.9 },
      { entity_id: mayaId, fact_type: "gender", fact_value: "Female", confidence: 0.9 },
      { entity_id: mayaId, fact_type: "school", fact_value: "Sunset Elementary", confidence: 0.8 },
      // TechFlow Inc (employer)
      { entity_id: techflowId, fact_type: "address", fact_value: "500 Market Street, San Francisco, CA 94105", confidence: 0.9 },
      { entity_id: techflowId, fact_type: "phone", fact_value: "(415) 555-8000", confidence: 0.85 },
      // Dr. Chen
      { entity_id: drChenId, fact_type: "full_name", fact_value: "Dr. Sarah Chen", confidence: 0.85 },
      { entity_id: drChenId, fact_type: "phone", fact_value: "(415) 555-3200", confidence: 0.8 },
      { entity_id: drChenId, fact_type: "specialty", fact_value: "Family Medicine", confidence: 0.8 },
    ];

    const { error: factsError } = await adminClient
      .from("entity_facts")
      .insert(
        facts.map((f) => ({ ...f, access_count: 1, has_conflict: false }))
      );

    if (factsError)
      throw new Error(`Failed to seed facts: ${factsError.message}`);

    // 4. Insert relationships
    const relationships = [
      { subject_entity_id: alexId, predicate: "spouse_of", object_entity_id: jordanId, confidence: 0.95 },
      { subject_entity_id: alexId, predicate: "parent_of", object_entity_id: mayaId, confidence: 0.9 },
      { subject_entity_id: jordanId, predicate: "parent_of", object_entity_id: mayaId, confidence: 0.9 },
      { subject_entity_id: alexId, predicate: "works_at", object_entity_id: techflowId, confidence: 0.95 },
    ];

    const { error: relError } = await adminClient
      .from("entity_relationships")
      .insert(relationships);

    if (relError)
      throw new Error(`Failed to seed relationships: ${relError.message}`);

    console.log("[AutoForm] Anonymous guest data seeded successfully:", {
      userId,
      entities: insertedEntities.length,
      facts: facts.length,
      relationships: relationships.length,
    });

    return NextResponse.json({
      status: "success",
      userId,
      entities: insertedEntities.length,
      facts: facts.length,
      relationships: relationships.length,
    });
  } catch (error) {
    console.error("[AutoForm] Failed to seed anonymous guest data:", error);
    return NextResponse.json(
      { error: "Seeding failed", details: String(error) },
      { status: 500 }
    );
  }
}
