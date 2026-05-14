#!/usr/bin/env node
/**
 * Fetch latest art therapy research papers from PubMed E-utilities API.
 * Uses art-therapy-specific search queries from the research toolkit.
 */

import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const PUBMED_SEARCH = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi";
const PUBMED_FETCH = "https://eutils.ncbi.nlm.nih.gov/entrez/efetch.fcgi";
const HEADERS = { "User-Agent": "ArtTherapyResearchBot/1.0 (research aggregator)" };
const TRACKING_FILE = resolve("docs/tracked-papers.json");

const SEARCH_QUERIES = [
  {
    name: "art-therapy-broad",
    query: '"Art Therapy"[Mesh] OR "art therapy"[tiab] OR "art psychotherapy"[tiab] OR "visual art therapy"[tiab] OR "active visual art therapy"[tiab] OR "art-based intervention"[tiab] OR "art based intervention"[tiab]',
  },
  {
    name: "creative-arts-therapies",
    query: '"creative arts therapy"[tiab] OR "creative arts therapies"[tiab] OR "expressive arts therapy"[tiab] OR "expressive therapies"[tiab] OR "arts therapies"[tiab] OR "arts psychotherapy"[tiab]',
  },
  {
    name: "arts-in-health",
    query: '"arts in health"[tiab] OR "arts for health"[tiab] OR "participatory arts"[tiab] OR "community art therapy"[tiab] OR "museum-based intervention"[tiab] OR "social prescribing"[tiab]',
  },
  {
    name: "art-making-mechanism",
    query: '"art-making"[tiab] OR "art making"[tiab] OR "visual journaling"[tiab] OR "mandala"[tiab] AND ("emotion regulation"[tiab] OR "self-expression"[tiab] OR "mentalization"[tiab] OR "embodiment"[tiab])',
  },
  {
    name: "art-therapy-mental-health",
    query: '("art therapy"[tiab] OR "visual art therapy"[tiab]) AND ("mental health"[tiab] OR depression[tiab] OR anxiety[tiab] OR PTSD[tiab] OR trauma[tiab] OR psychosis[tiab])',
  },
  {
    name: "art-therapy-children",
    query: '("art therapy"[tiab] OR "art psychotherapy"[tiab]) AND (child*[tiab] OR adolescent*[tiab] OR youth[tiab] OR pediatric[tiab])',
  },
  {
    name: "art-therapy-trauma",
    query: '("art therapy"[tiab] OR "art psychotherapy"[tiab]) AND (PTSD[tiab] OR "post-traumatic stress"[tiab] OR trauma[tiab] OR "complex trauma"[tiab])',
  },
  {
    name: "art-therapy-dementia",
    query: '("art therapy"[tiab] OR "visual art therapy"[tiab]) AND (dementia[tiab] OR Alzheimer*[tiab] OR "older adult*"[tiab])',
  },
  {
    name: "art-therapy-cancer",
    query: '("art therapy"[tiab] OR "visual art therapy"[tiab]) AND (cancer[tiab] OR oncology[tiab] OR palliative[tiab])',
  },
  {
    name: "art-therapy-neuroscience",
    query: '("art therapy"[tiab] OR "art-making"[tiab]) AND (neuroscience[tiab] OR neurobiolog*[tiab] OR brain[tiab] OR neural[tiab] OR neuroimaging[tiab] OR "emotion regulation"[tiab])',
  },
  {
    name: "art-therapy-systematic-review",
    query: '("art therapy"[tiab] OR "visual art therapy"[tiab]) AND ("systematic review"[pt] OR "meta-analysis"[pt] OR "scoping review"[tiab])',
  },
];

function getTaipeiDate() {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
}

function formatDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatPubDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}/${m}/${day}`;
}

function loadTrackedPmids() {
  if (existsSync(TRACKING_FILE)) {
    try {
      const data = JSON.parse(readFileSync(TRACKING_FILE, "utf-8"));
      return new Set(data.pmids || []);
    } catch {
      return new Set();
    }
  }
  return new Set();
}

function saveTrackedPmids(pmids) {
  const dir = resolve("docs");
  const data = { lastUpdated: formatDate(getTaipeiDate()), pmids: [...pmids] };
  writeFileSync(TRACKING_FILE, JSON.stringify(data, null, 2), "utf-8");
}

async function searchPapers(query, days, retmax) {
  const lookback = new Date(getTaipeiDate());
  lookback.setDate(lookback.getDate() - days);
  const dateFrom = formatPubDate(lookback);

  const params = new URLSearchParams({
    db: "pubmed",
    term: `${query} AND "${dateFrom}"[Date - Publication] : "3000"[Date - Publication]`,
    retmax: String(retmax),
    sort: "date",
    retmode: "json",
  });

  const url = `${PUBMED_SEARCH}?${params}`;
  const resp = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(30000) });
  if (!resp.ok) throw new Error(`PubMed search HTTP ${resp.status}`);
  const data = await resp.json();
  return data?.esearchresult?.idlist || [];
}

async function fetchDetails(pmids) {
  if (!pmids.length) return [];
  const params = new URLSearchParams({
    db: "pubmed",
    id: pmids.join(","),
    retmode: "xml",
  });

  const url = `${PUBMED_FETCH}?${params}`;
  const resp = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(60000) });
  if (!resp.ok) throw new Error(`PubMed fetch HTTP ${resp.status}`);
  const xml = await resp.text();

  const papers = [];
  const articleRegex = /<PubmedArticle>([\s\S]*?)<\/PubmedArticle>/g;
  let match;

  while ((match = articleRegex.exec(xml)) !== null) {
    const block = match[1];
    const titleMatch = block.match(/<ArticleTitle>([\s\S]*?)<\/ArticleTitle>/);
    const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, "").trim() : "";

    const abstractParts = [];
    const absRegex = /<AbstractText[^>]*>([\s\S]*?)<\/AbstractText>/g;
    let absMatch;
    while ((absMatch = absRegex.exec(block)) !== null) {
      const labelMatch = absMatch[0].match(/Label="([^"]+)"/);
      const label = labelMatch ? labelMatch[1] : "";
      const text = absMatch[1].replace(/<[^>]+>/g, "").trim();
      if (label && text) abstractParts.push(`${label}: ${text}`);
      else if (text) abstractParts.push(text);
    }
    const abstract = abstractParts.join(" ").slice(0, 2000);

    const journalMatch = block.match(/<Title>([\s\S]*?)<\/Title>/);
    const journal = journalMatch ? journalMatch[1].trim() : "";

    const yearMatch = block.match(/<Year>(\d{4})<\/Year>/);
    const monthMatch = block.match(/<Month>([^<]+)<\/Month>/);
    const dayMatch = block.match(/<Day>(\d+)<\/Day>/);
    const dateStr = [yearMatch?.[1], monthMatch?.[1], dayMatch?.[1]].filter(Boolean).join(" ");

    const pmidMatch = block.match(/<PMID[^>]*>(\d+)<\/PMID>/);
    const pmid = pmidMatch ? pmidMatch[1] : "";
    const link = pmid ? `https://pubmed.ncbi.nlm.nih.gov/${pmid}/` : "";

    const keywords = [];
    const kwRegex = /<Keyword>([^<]+)<\/Keyword>/g;
    let kwMatch;
    while ((kwMatch = kwRegex.exec(block)) !== null) {
      keywords.push(kwMatch[1].trim());
    }

    if (title) {
      papers.push({ pmid, title, journal, date: dateStr, abstract, url: link, keywords });
    }
  }
  return papers;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const args = process.argv.slice(2);
  const days = parseInt(args.find((a) => a.startsWith("--days="))?.split("=")[1] || "7", 10);
  const maxPapers = parseInt(args.find((a) => a.startsWith("--max-papers="))?.split("=")[1] || "50", 10);
  const outputFile = args.find((a) => a.startsWith("--output="))?.split("=")[1] || "papers.json";

  const trackedPmids = loadTrackedPmids();
  console.error(`[INFO] Loaded ${trackedPmids.size} previously tracked PMIDs`);

  const allPmids = new Set();
  for (const sq of SEARCH_QUERIES) {
    try {
      console.error(`[INFO] Searching: ${sq.name}...`);
      const ids = await searchPapers(sq.query, days, Math.ceil(maxPapers / SEARCH_QUERIES.length) + 5);
      for (const id of ids) allPmids.add(id);
      await sleep(400);
    } catch (e) {
      console.error(`[WARN] Search "${sq.name}" failed: ${e.message}`);
    }
  }

  let pmidList = [...allPmids].slice(0, maxPapers);
  console.error(`[INFO] Found ${pmidList.length} unique PMIDs (before dedup)`);

  const newPmids = pmidList.filter((id) => !trackedPmids.has(id));
  console.error(`[INFO] ${newPmids.length} new PMIDs (not in previous reports)`);

  if (!newPmids.length) {
    console.error("[INFO] No new papers found");
    const output = {
      date: formatDate(getTaipeiDate()),
      count: 0,
      papers: [],
    };
    writeFileSync(outputFile, JSON.stringify(output, null, 2), "utf-8");
    return;
  }

  const papers = await fetchDetails(newPmids);
  console.error(`[INFO] Fetched details for ${papers.length} papers`);

  for (const p of papers) {
    trackedPmids.add(p.pmid);
  }
  saveTrackedPmids(trackedPmids);

  const output = {
    date: formatDate(getTaipeiDate()),
    count: papers.length,
    papers,
  };

  writeFileSync(outputFile, JSON.stringify(output, null, 2), "utf-8");
  console.error(`[INFO] Saved to ${outputFile}`);
}

main().catch((e) => {
  console.error(`[FATAL] ${e.message}`);
  process.exit(1);
});
