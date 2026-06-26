import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { conceptGraphs, documents } from "@/db/schema";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { eq, desc } from "drizzle-orm";
import { enforceRateLimit, getRateLimitKey, RATE_LIMITS } from "@/lib/rate-limit";
import type {
  Concept,
  ConceptEdge,
  ConceptCluster,
} from "@/types/concept-graph";

/**
 * GET /api/concept-graph/global — aggregate the current user's concept
 * graphs into a single merged "global" knowledge graph.
 *
 * P2-3 (revised): each document (project) is rendered as ONE cluster
 * big-circle on the canvas. All concepts originating from that
 * document live inside that circle. This gives the user a clear
 * "one circle per article" overview — exactly like Obsidian's graph
 * where each note is a node and links connect notes.
 *
 * Concept merging:
 *  - Concepts with the same label (case-insensitive, trimmed) across
 *    different documents ARE merged into a single node — this creates
 *    the cross-article edges that make the global graph useful.
 *  - A merged concept belongs to the document that contributed the
 *    highest importance (its `clusterId` = that document's id). This
 *    means a concept shared by 3 articles will visually sit inside
 *    the big-circle of the article where it's most prominent, but
 *    edges will connect it to concepts in the other articles too.
 *
 * Cluster = document:
 *  - One ConceptCluster per document, with the document's id + title.
 *  - The frontend's ClusterGroupNode renders the big circle with the
 *    document title as its label.
 *  - This reuses the existing per-project cluster rendering pipeline
 *    (conceptGraphToParsedDocument + clusterForceDirectedLayout) so
 *    the global graph looks and behaves exactly like a single-project
 *    graph, just with document-level grouping instead of semantic
 *    clusters.
 */
const MAX_CONCEPTS = 200;
const MAX_DOCUMENTS = 30; // cap so a user with 100s of projects doesn't overload the canvas

// Stable color palette for document-clusters. Cycled by document index
// so each article gets a visually distinct big-circle color.
const DOC_COLORS = [
  "slate", "rust", "olive", "navy", "plum", "teal", "umber", "moss",
];

function sanitizeKey(label: string): string {
  return (
    "g-" +
    label
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64) || "g-unknown"
  );
}

export async function GET(request: NextRequest) {
  try {
    const rlKey = getRateLimitKey(request);
    const blocked = enforceRateLimit(request, rlKey, RATE_LIMITS.light);
    if (blocked) return blocked;

    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Load all the user's concept graphs, joined with the parent
    // document's title so we can use the title as the cluster label.
    const rows = await db
      .select({
        id: conceptGraphs.id,
        title: conceptGraphs.title,
        type: conceptGraphs.type,
        concepts: conceptGraphs.concepts,
        edges: conceptGraphs.edges,
        clusters: conceptGraphs.clusters,
        documentId: conceptGraphs.documentId,
        docTitle: documents.title,
      })
      .from(conceptGraphs)
      .leftJoin(documents, eq(conceptGraphs.documentId, documents.id))
      .where(eq(conceptGraphs.userId, session.user.id))
      .orderBy(desc(conceptGraphs.createdAt));

    if (rows.length === 0) {
      return NextResponse.json({ graph: null });
    }

    // ----- Dedupe by document -----
    // The concept_graphs table can hold multiple rows per document
    // (e.g. one per re-generation, or legacy records without a
    // documentId). For the global view we want at most ONE graph per
    // document, so we keep the most recent row per documentId. Rows
    // with a null documentId (orphans) are deduped by their primary
    // id and treated as a separate cluster each.
    const latestPerDocument = new Map<
      string,
      (typeof rows)[number]
    >();
    const orphanRows: typeof rows = [];
    for (const row of rows) {
      if (row.documentId) {
        // Since rows are ordered by createdAt DESC, the first one we
        // see for a given documentId is the most recent. First-write-wins.
        if (!latestPerDocument.has(row.documentId)) {
          latestPerDocument.set(row.documentId, row);
        }
      } else {
        orphanRows.push(row);
      }
    }
    // Combine: real documents first (one row each), then any orphans
    // (one row each, treated as their own clusters).
    const dedupedRows = [
      ...latestPerDocument.values(),
      ...orphanRows,
    ];

    // Cap the number of documents to keep the canvas readable. Keep
    // the most recent MAX_DOCUMENTS.
    const activeRows = dedupedRows.slice(0, MAX_DOCUMENTS);

    // ----- Build the document-as-cluster map -----
    // Each document becomes one cluster. The cluster id is the
    // document id so concepts can reference it via `clusterId`.
    const docClusterMap = new Map<
      string,
      { id: string; label: string; colorName: string; conceptIds: string[] }
    >();

    activeRows.forEach((row, idx) => {
      const docId = row.documentId ?? row.id;
      const docTitle = row.docTitle || row.title || "Untitled";
      const colorName = DOC_COLORS[idx % DOC_COLORS.length];
      docClusterMap.set(docId, {
        id: docId,
        label: docTitle,
        colorName,
        conceptIds: [],
      });
    });

    // ----- Merge concepts by normalized label -----
    // Same-label concepts across documents merge into one node.
    // The merged node's clusterId = the document that had the highest
    // importance for this concept (so it sits inside that document's
    // big-circle). Its sourceDocuments list tracks all articles it
    // appears in (for the click-to-navigate feature).
    const mergedConcepts = new Map<
      string,
      Concept & {
        sourceDocuments: Array<{ id: string; title: string }>;
        // Best (highest-importance) document id — becomes clusterId.
        bestDocId: string;
        bestImportance: number;
      }
    >();
    const idRemap = new Map<string, string>();

    for (const row of activeRows) {
      const docId = row.documentId ?? row.id;
      // Skip documents that aren't in our active set (shouldn't happen
      // since we already sliced, but defensive).
      if (!docClusterMap.has(docId)) continue;

      const sourceDoc = {
        id: docId,
        title: docClusterMap.get(docId)!.label,
      };
      const concepts = (row.concepts as Concept[]) || [];
      for (const c of concepts) {
        if (!c || typeof c.id !== "string" || typeof c.label !== "string") continue;
        const key = c.label.trim().toLowerCase();
        if (!key) continue;
        const mergedId = sanitizeKey(c.label);
        idRemap.set(`${row.id}:${c.id}`, mergedId);

        const importance = c.importance ?? 0;
        const existing = mergedConcepts.get(key);
        if (existing) {
          existing.importance = Math.max(existing.importance, importance);
          existing.frequency = (existing.frequency ?? 0) + (c.frequency ?? 0);
          if (!existing.sourceDocuments.some((d) => d.id === sourceDoc.id)) {
            existing.sourceDocuments.push(sourceDoc);
          }
          // Track which document this concept is most prominent in.
          if (importance > existing.bestImportance) {
            existing.bestImportance = importance;
            existing.bestDocId = docId;
          }
          if (c.description && c.description.length > (existing.description?.length ?? 0)) {
            existing.description = c.description;
          }
          if (Array.isArray(c.aliases)) {
            for (const a of c.aliases) {
              if (a && !existing.aliases.includes(a)) existing.aliases.push(a);
            }
          }
          if (Array.isArray(c.anchors) && c.anchors.length > existing.anchors.length) {
            existing.anchors = c.anchors;
          }
        } else {
          mergedConcepts.set(key, {
            id: mergedId,
            label: c.label,
            type: c.type ?? "term",
            aliases: Array.isArray(c.aliases) ? [...c.aliases] : [],
            frequency: c.frequency ?? 0,
            importance,
            clusterId: docId, // tentative; finalised below
            description: c.description,
            anchors: Array.isArray(c.anchors) ? [...c.anchors] : [],
            sourceDocuments: [sourceDoc],
            bestDocId: docId,
            bestImportance: importance,
          });
        }
      }
    }

    if (mergedConcepts.size === 0) {
      return NextResponse.json({ graph: null });
    }

    // Finalise each concept's clusterId to its best document.
    for (const c of mergedConcepts.values()) {
      c.clusterId = c.bestDocId;
      // Register the concept in its document-cluster's conceptIds list.
      const docCluster = docClusterMap.get(c.bestDocId);
      if (docCluster) docCluster.conceptIds.push(c.id);
    }

    // ----- Merge edges by (source, target) pair -----
    const mergedEdgesMap = new Map<
      string,
      ConceptEdge & { weight: number }
    >();

    for (const row of activeRows) {
      const docId = row.documentId ?? row.id;
      if (!docClusterMap.has(docId)) continue;
      const edges = (row.edges as ConceptEdge[]) || [];
      for (const e of edges) {
        if (!e || !e.source || !e.target) continue;
        const src = idRemap.get(`${row.id}:${e.source}`);
        const tgt = idRemap.get(`${row.id}:${e.target}`);
        if (!src || !tgt || src === tgt) continue;
        const [a, b] = src < tgt ? [src, tgt] : [tgt, src];
        const pairKey = `${a}__${b}`;
        const existing = mergedEdgesMap.get(pairKey);
        if (existing) {
          existing.weight += e.weight ?? 1;
          existing.confidence = Math.max(existing.confidence, e.confidence ?? 0);
          if (Array.isArray(e.evidence)) {
            for (const ev of e.evidence) {
              if (ev && !existing.evidence.includes(ev)) existing.evidence.push(ev);
            }
          }
        } else {
          mergedEdgesMap.set(pairKey, {
            id: `ge-${a}-${b}`,
            source: a,
            target: b,
            type: e.type ?? "co-occurs",
            weight: e.weight ?? 1,
            evidence: Array.isArray(e.evidence) ? [...e.evidence] : [],
            confidence: e.confidence ?? 0,
          });
        }
      }
    }

    // ----- Cap to top N concepts by importance + degree -----
    const degreeMap = new Map<string, number>();
    for (const e of mergedEdgesMap.values()) {
      degreeMap.set(e.source, (degreeMap.get(e.source) ?? 0) + 1);
      degreeMap.set(e.target, (degreeMap.get(e.target) ?? 0) + 1);
    }

    const allConcepts = Array.from(mergedConcepts.values()).map((c) => ({
      ...c,
      _score: (c.importance ?? 0) + Math.log(1 + (degreeMap.get(c.id) ?? 0)) / Math.log(1 + 20),
    }));
    allConcepts.sort((a, b) => b._score - a._score);

    const keptConcepts = allConcepts.slice(0, MAX_CONCEPTS);
    const keptIds = new Set(keptConcepts.map((c) => c.id));

    // Drop edges that reference dropped concepts.
    const keptEdges: ConceptEdge[] = [];
    for (const e of mergedEdgesMap.values()) {
      if (!keptIds.has(e.source) || !keptIds.has(e.target)) continue;
      keptEdges.push({
        id: e.id,
        source: e.source,
        target: e.target,
        type: e.type,
        weight: e.weight,
        evidence: e.evidence,
        confidence: e.confidence,
      });
    }

    // Strip temp fields + rebuild cluster conceptIds for kept set.
    const finalConcepts: Concept[] = keptConcepts.map(({ _score, bestDocId, bestImportance, ...rest }) => rest);
    const finalClusters: ConceptCluster[] = [];
    for (const docCluster of docClusterMap.values()) {
      const ids = docCluster.conceptIds.filter((id) => keptIds.has(id));
      if (ids.length > 0) {
        finalClusters.push({
          id: docCluster.id,
          label: docCluster.label,
          colorName: docCluster.colorName,
          conceptIds: ids,
          level: 0,
        });
      }
    }

    const graph = {
      id: "global",
      title: "Global Knowledge Graph",
      type: "paper" as const,
      metadata: undefined,
      rawText: "",
      concepts: finalConcepts,
      edges: keptEdges,
      clusters: finalClusters,
      createdAt: new Date().toISOString(),
    };

    return NextResponse.json({ graph });
  } catch (error: any) {
    console.error("Global concept graph error:", error);
    return NextResponse.json(
      { error: "An internal error occurred. Please try again." },
      { status: 500 }
    );
  }
}
