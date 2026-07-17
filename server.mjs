import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import dns from "node:dns/promises";
import net from "node:net";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(here, "public");
const port = Number(process.env.QUESTION_APP_PORT || 4173);
const maxBodyBytes = 8 * 1024 * 1024;
const maxSourceBytes = 4 * 1024 * 1024;
const preparedDownloads = new Map();

export const defaultColumns = [
  { key: "question", header: "question" },
  { key: "option_a", header: "option_a" },
  { key: "option_b", header: "option_b" },
  { key: "option_c", header: "option_c" },
  { key: "option_d", header: "option_d" },
  { key: "correct_option", header: "correct_option" },
  { key: "marks", header: "marks" },
  { key: "topic", header: "topic" },
  { key: "difficulty", header: "difficulty" }
];

const entityMap = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decodeEntities(value) {
  return String(value || "")
    .replace(/&#(x?[0-9a-f]+);/gi, (_, code) => {
      const number = code[0].toLowerCase() === "x" ? parseInt(code.slice(1), 16) : parseInt(code, 10);
      return Number.isFinite(number) ? String.fromCodePoint(number) : _;
    })
    .replace(/&([a-z]+);/gi, (all, name) => entityMap[name.toLowerCase()] ?? all);
}

function htmlToText(html) {
  return decodeEntities(String(html || ""))
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|section|article|pre|tr)>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function cleanLine(line) {
  return line.replace(/^\s*(?:\d+[.)]|question\s*\d*[:.)-]?)\s*/i, "").trim();
}

function baseQuestion(type, question, sourceUrl) {
  return {
    _type: type,
    question: question.trim(),
    option_a: "",
    option_b: "",
    option_c: "",
    option_d: "",
    correct_option: "",
    marks: 1,
    topic: "",
    difficulty: "",
    _explanation: "",
    _source_url: sourceUrl || ""
  };
}

function extractJson(text, sourceUrl, forcedType) {
  try {
    const parsed = JSON.parse(text);
    const rows = Array.isArray(parsed) ? parsed : parsed.questions || parsed.items || parsed.data;
    if (!Array.isArray(rows)) return [];
    return rows.map((row) => {
      const result = baseQuestion(forcedType === "auto" ? (row.type || row._type || "MCQ") : forcedType, row.question || row.prompt || row.title || "", sourceUrl);
      result.option_a = row.option_a ?? row.optionA ?? "";
      result.option_b = row.option_b ?? row.optionB ?? "";
      result.option_c = row.option_c ?? row.optionC ?? "";
      result.option_d = row.option_d ?? row.optionD ?? "";
      result.correct_option = row.correct_option ?? row.correctAnswer ?? row.answer ?? "";
      result.marks = row.marks ?? 1;
      result.topic = row.topic ?? "";
      result.difficulty = row.difficulty ?? "";
      result._source_url = row.source_url || row.sourceUrl || row.url || sourceUrl || "";
      return result;
    }).filter((row) => row.question);
  } catch {
    return [];
  }
}

function extractMcqs(text, sourceUrl) {
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  const questions = [];
  let current = null;
  const optionPattern = /^(?:option\s*)?([A-Da-d])[).:\-]\s*(.+)$/;
  const answerPattern = /^(?:correct\s*)?answer\s*[:\-]\s*(.+)$/i;
  const explanationPattern = /^(?:explanation|solution)\s*[:\-]\s*(.*)$/i;

  const finish = () => {
    if (current?.question && [current.option_a, current.option_b, current.option_c, current.option_d].filter(Boolean).length >= 2) {
      questions.push(current);
    }
    current = null;
  };

  for (const line of lines) {
    const option = line.match(optionPattern);
    const answer = line.match(answerPattern);
    const explanation = line.match(explanationPattern);
    const looksLikeQuestion = /\?$/.test(line) || /^(?:q(?:uestion)?\s*)?\d+[.)\-:]/i.test(line);

    if (looksLikeQuestion && !option && !answer) {
      finish();
      current = baseQuestion("MCQ", cleanLine(line), sourceUrl);
    } else if (current && option) {
      current[`option_${option[1].toLowerCase()}`] = option[2].trim();
    } else if (current && answer) {
      current.correct_option = answer[1].trim();
    } else if (current && explanation) {
      current._explanation = explanation[1].trim();
    } else if (current && current._explanation && line.length < 500) {
      current._explanation += ` ${line}`;
    }
  }
  finish();
  return questions;
}

function section(text, startNames, endNames) {
  const start = startNames.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const end = endNames.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const match = text.match(new RegExp(`(?:^|\\n)(?:${start})\\s*[:\\n-]+([\\s\\S]*?)(?=\\n(?:${end})\\s*[:\\n-]+|$)`, "i"));
  return match ? match[1].trim().slice(0, 12000) : "";
}

function extractCoding(text, sourceUrl) {
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return [];
  const markers = ["description", "problem statement", "input format", "output format", "constraints", "example", "sample input"];
  const markerCount = markers.filter((marker) => new RegExp(`(^|\\n)${marker}`, "i").test(text)).length;
  if (markerCount < 2 && text.length < 120) return [];
  const title = lines.find((line) => line.length >= 4 && line.length <= 160 && !markers.some((m) => line.toLowerCase().startsWith(m))) || "Coding problem";
  const row = baseQuestion("Coding", title, sourceUrl);
  const description = section(text, ["description", "problem statement", "statement"], ["input format", "input", "output format", "constraints", "example", "samples"]);
  const inputFormat = section(text, ["input format", "input"], ["output format", "output", "constraints", "example", "samples"]);
  const outputFormat = section(text, ["output format", "output"], ["constraints", "example", "samples", "notes"]);
  const constraints = section(text, ["constraints"], ["input format", "output format", "example", "samples", "notes"]);
  const examples = section(text, ["example", "examples", "sample input", "samples"], ["explanation", "notes", "constraints"]);
  const sections = [
    title,
    description && `Problem Statement:\n${description}`,
    inputFormat && `Input Format:\n${inputFormat}`,
    outputFormat && `Output Format:\n${outputFormat}`,
    constraints && `Constraints:\n${constraints}`,
    examples && `Examples:\n${examples}`
  ].filter(Boolean);
  row.question = sections.length > 1 ? sections.join("\n\n") : text.slice(0, 12000);
  return [row];
}

export function extractQuestions(input, sourceUrl = "", forcedType = "auto") {
  const original = String(input || "").trim();
  if (!original) return [];
  const jsonRows = extractJson(original, sourceUrl, forcedType);
  if (jsonRows.length) return jsonRows;
  const text = /<\w+[\s>]/.test(original) ? htmlToText(original) : original;
  if (forcedType === "MCQ") return extractMcqs(text, sourceUrl);
  if (forcedType === "Coding") return extractCoding(text, sourceUrl);
  const mcqs = extractMcqs(text, sourceUrl);
  return mcqs.length ? mcqs : extractCoding(text, sourceUrl);
}

function shuffleOptions(options) {
  const copy = [...options];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

export function mapOpenTriviaQuestions(results, marks = 1) {
  const normalizedTopics = {
    "Science: Computers": "Computer Science",
    "Science: Mathematics": "Mathematics",
    "Science & Nature": "Science",
    "General Knowledge": "General Knowledge"
  };
  return (Array.isArray(results) ? results : []).map((item) => {
    const correct = decodeEntities(item.correct_answer || "");
    const options = shuffleOptions([...(item.incorrect_answers || []).map(decodeEntities), correct]).slice(0, 4);
    while (options.length < 4) options.push("");
    const correctIndex = options.indexOf(correct);
    return {
      question: decodeEntities(item.question || ""),
      option_a: options[0],
      option_b: options[1],
      option_c: options[2],
      option_d: options[3],
      correct_option: correctIndex >= 0 ? "ABCD"[correctIndex] : "",
      marks,
      topic: normalizedTopics[decodeEntities(item.category || "General Knowledge")] || decodeEntities(item.category || "General Knowledge"),
      difficulty: item.difficulty ? item.difficulty[0].toUpperCase() + item.difficulty.slice(1) : "",
      _source_name: "Open Trivia DB",
      _source_url: "https://opentdb.com/",
      _license: "CC BY-SA 4.0"
    };
  }).filter((row) => row.question && row.correct_option);
}

async function fetchOpenTrivia(payload) {
  const amount = Math.min(50, Math.max(1, Number(payload.amount) || 10));
  const category = Number(payload.category);
  const marks = Math.min(100, Math.max(0, Number(payload.marks) || 1));
  const difficulty = ["easy", "medium", "hard"].includes(payload.difficulty) ? payload.difficulty : "";
  const params = new URLSearchParams({ amount: String(amount), type: "multiple" });
  if (Number.isInteger(category) && category >= 9 && category <= 32) params.set("category", String(category));
  if (difficulty) params.set("difficulty", difficulty);
  const response = await fetch(`https://opentdb.com/api.php?${params}`, {
    headers: { "User-Agent": "QuestionHarvester/0.2 (+local educational question organizer)" },
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error(`Open Trivia DB returned HTTP ${response.status}.`);
  const data = await response.json();
  if (data.response_code === 1) throw new Error("Open Trivia DB does not have enough questions for those filters. Try a smaller amount or Any difficulty.");
  if (data.response_code === 5) throw new Error("Open Trivia DB allows one request every 5 seconds. Please wait and try again.");
  if (data.response_code !== 0) throw new Error(`Open Trivia DB could not complete the request (code ${data.response_code}).`);
  return mapOpenTriviaQuestions(data.results, marks);
}

const mmluTopics = {
  computer_science: { label: "Computer Science", config: "college_computer_science", query: "" },
  programming_fundamentals: { label: "Programming Fundamentals", config: "high_school_computer_science", query: "" },
  networking: { label: "Networking", config: "college_computer_science", query: "network" },
  operating_systems: { label: "Operating Systems", config: "college_computer_science", query: "operating system" },
  dbms: { label: "DBMS", config: "college_computer_science", query: "database" },
  data_structures: { label: "Data Structures", config: "college_computer_science", query: "data structure" },
  algorithms: { label: "Algorithms", config: "college_computer_science", query: "algorithm" },
  object_oriented_programming: { label: "Object-Oriented Programming", config: "college_computer_science", query: "object oriented" },
  computer_architecture: { label: "Computer Architecture", config: "college_computer_science", query: "architecture" },
  cybersecurity: { label: "Cybersecurity", config: "computer_security", query: "" },
  ai_machine_learning: { label: "AI & Machine Learning", config: "machine_learning", query: "" },
  software_engineering: { label: "Software Engineering", config: "college_computer_science", query: "software" },
  theory_of_computation: { label: "Theory of Computation", config: "college_computer_science", query: "automata" },
  compiler_design: { label: "Compiler Design", config: "college_computer_science", query: "compiler" },
  mathematics: { label: "Mathematics", config: "college_mathematics", query: "" },
  analytical_reasoning: { label: "Analytical Reasoning", config: "formal_logic", query: "" }
};

export function mapMmluQuestions(rows, marks = 1, topicOverride = "", difficulty = "Medium") {
  return (Array.isArray(rows) ? rows : []).map((entry) => entry?.row || entry).map((item) => {
    const choices = Array.isArray(item?.choices) ? item.choices.map((choice) => String(choice ?? "")) : [];
    while (choices.length < 4) choices.push("");
    const answerIndex = typeof item?.answer === "number" ? item.answer : "ABCD".indexOf(String(item?.answer || "").toUpperCase());
    const subject = String(item?.subject || "computer_science");
    return {
      question: String(item?.question || "").trim(),
      option_a: choices[0],
      option_b: choices[1],
      option_c: choices[2],
      option_d: choices[3],
      correct_option: answerIndex >= 0 && answerIndex < 4 ? "ABCD"[answerIndex] : "",
      marks,
      topic: topicOverride || subject.split("_").map((word) => word[0]?.toUpperCase() + word.slice(1)).join(" "),
      difficulty,
      _source_name: "MMLU",
      _source_url: "https://huggingface.co/datasets/cais/mmlu",
      _license: "MIT"
    };
  }).filter((row) => row.question && row.correct_option && [row.option_a,row.option_b,row.option_c,row.option_d].filter(Boolean).length === 4);
}

async function fetchMmlu(payload) {
  const topic = mmluTopics[payload.topic] || mmluTopics.computer_science;
  const amount = Math.min(50, Math.max(1, Number(payload.amount) || 10));
  const marks = Math.min(100, Math.max(0, Number(payload.marks) || 1));
  const difficulty = ["easy", "medium", "hard"].includes(payload.difficulty) ? payload.difficulty : "medium";
  const params = new URLSearchParams({ dataset: "cais/mmlu", config: topic.config, split: "test", offset: "0", length: "100" });
  if (topic.query) params.set("query", topic.query);
  const endpoint = topic.query ? "search" : "rows";
  const response = await fetch(`https://datasets-server.huggingface.co/${endpoint}?${params}`, {
    headers: { "User-Agent": "QuestionHarvester/0.3 (+local educational question organizer)" },
    signal: AbortSignal.timeout(20000)
  });
  if (!response.ok) throw new Error(`The MMLU dataset service returned HTTP ${response.status}.`);
  const data = await response.json();
  const available = mapMmluQuestions(data.rows, marks, topic.label, difficulty[0].toUpperCase() + difficulty.slice(1));
  if (!available.length) throw new Error(`No MMLU questions were available for ${topic.label}. Try another standard subject.`);
  return shuffleOptions(available).slice(0, Math.min(amount, available.length));
}

function isPrivateIp(address) {
  if (net.isIPv4(address)) {
    const [a, b] = address.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  const lower = address.toLowerCase();
  return lower === "::1" || lower === "::" || lower.startsWith("fc") || lower.startsWith("fd") || lower.startsWith("fe80:");
}

async function assertPublicUrl(value) {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Only http:// and https:// URLs are allowed.");
  if (["localhost", "localhost.localdomain"].includes(url.hostname.toLowerCase())) throw new Error("Local addresses are not allowed.");
  const addresses = await dns.lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateIp(address))) throw new Error("Private or local network addresses are not allowed.");
  return url;
}

async function fetchPublicPage(inputUrl, redirects = 0) {
  if (redirects > 4) throw new Error("Too many redirects.");
  const url = await assertPublicUrl(inputUrl);
  const response = await fetch(url, {
    redirect: "manual",
    headers: { "User-Agent": "QuestionHarvester/0.1 (+local educational content organizer)" },
    signal: AbortSignal.timeout(15000)
  });
  if ([301, 302, 303, 307, 308].includes(response.status)) {
    const location = response.headers.get("location");
    if (!location) throw new Error("Redirect did not include a destination.");
    return fetchPublicPage(new URL(location, url).toString(), redirects + 1);
  }
  if (response.status === 403) {
    throw new Error("This website requires browser verification (HTTP 403). Click Open page, complete its verification normally, select and copy the question text, then return here and click Paste copied text.");
  }
  if (response.status === 401) {
    throw new Error("This page requires authentication (HTTP 401). Open it while signed in, then copy its text or save it as HTML and use the app's Pasted text / Load file option.");
  }
  if (response.status === 429) {
    throw new Error("This website is rate-limiting requests (HTTP 429). Wait before trying again, or import a saved HTML/text copy of the page.");
  }
  if (!response.ok) throw new Error(`The website returned HTTP ${response.status}. Try the Pasted text / Load file option instead.`);
  const length = Number(response.headers.get("content-length") || 0);
  if (length > maxSourceBytes) throw new Error("Source is larger than 4 MB.");
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > maxSourceBytes) throw new Error("Source is larger than 4 MB.");
  return { text: buffer.toString("utf8"), finalUrl: url.toString() };
}

function csvCell(value) {
  let text = value == null ? "" : String(value);
  // Prevent spreadsheet applications from evaluating imported text as a formula.
  if (/^[\t\r ]*[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function createCsvBuffer(questions) {
  const rows = Array.isArray(questions) ? questions : [];
  const header = defaultColumns.map(({ header }) => csvCell(header)).join(",");
  const body = rows.map((row) => defaultColumns.map(({ key }) => csvCell(row?.[key])).join(","));
  // The UTF-8 BOM keeps non-English text readable in common spreadsheet applications.
  return Buffer.from(`\uFEFF${[header, ...body].join("\r\n")}\r\n`, "utf8");
}

async function readJson(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBodyBytes) throw new Error("Request is larger than 8 MB.");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function json(res, status, value) {
  const body = Buffer.from(JSON.stringify(value));
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": body.length, "Cache-Control": "no-store" });
  res.end(body);
}

async function getAppVersion() {
  const tracked = [
    fileURLToPath(import.meta.url),
    path.join(publicDir, "index.html"),
    path.join(publicDir, "app.js"),
    path.join(publicDir, "styles.css")
  ];
  const stats = await Promise.all(tracked.map((file) => fs.stat(file)));
  return String(Math.max(...stats.map((stat) => stat.mtimeMs)));
}

async function serveStatic(req, res) {
  const requestPath = new URL(req.url, "http://localhost").pathname;
  const mapped = requestPath === "/" ? "/index.html" : requestPath;
  const resolved = path.resolve(publicDir, `.${mapped}`);
  if (!resolved.startsWith(`${publicDir}${path.sep}`)) return json(res, 404, { error: "Not found" });
  try {
    const body = await fs.readFile(resolved);
    const type = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" }[path.extname(resolved)] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": `${type}; charset=utf-8`, "Content-Length": body.length, "Cache-Control": "no-store" });
    res.end(body);
  } catch {
    json(res, 404, { error: "Not found" });
  }
}

export function createServer() {
  return http.createServer(async (req, res) => {
    try {
      const requestUrl = new URL(req.url, "http://localhost");
      if (req.method === "GET" && new URL(req.url, "http://localhost").pathname === "/api/version") {
        return json(res, 200, { version: await getAppVersion() });
      }
      if (req.method === "POST" && req.url === "/api/catalog/opentdb") {
        const payload = await readJson(req);
        const questions = await fetchOpenTrivia(payload);
        return json(res, 200, { questions, attribution: "Open Trivia DB — CC BY-SA 4.0" });
      }
      if (req.method === "POST" && req.url === "/api/catalog/mmlu") {
        const payload = await readJson(req);
        const questions = await fetchMmlu(payload);
        return json(res, 200, { questions, attribution: "MMLU — MIT License" });
      }
      if (req.method === "POST" && req.url === "/api/extract") {
        const payload = await readJson(req);
        const sources = Array.isArray(payload.sources) ? payload.sources.slice(0, 20) : [];
        const results = [];
        const errors = [];
        for (const source of sources) {
          try {
            const forcedType = ["MCQ", "Coding"].includes(source.type) ? source.type : "auto";
            if (source.mode === "url") {
              const fetched = await fetchPublicPage(source.value);
              results.push(...extractQuestions(fetched.text, fetched.finalUrl, forcedType));
            } else {
              results.push(...extractQuestions(source.value, source.sourceUrl || "", forcedType));
            }
          } catch (error) {
            errors.push({ source: String(source.value || "").slice(0, 200), error: error.message });
          }
        }
        return json(res, 200, { questions: results, errors });
      }
      if (req.method === "POST" && req.url === "/api/export") {
        const payload = await readJson(req);
        const body = createCsvBuffer(payload.questions);
        res.writeHead(200, {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": 'attachment; filename="question-bank.csv"',
          "Content-Length": body.length
        });
        return res.end(body);
      }
      if (req.method === "POST" && req.url === "/api/export/prepare") {
        const payload = await readJson(req);
        const body = createCsvBuffer(payload.questions);
        for (const [existingToken, item] of preparedDownloads) {
          if (item.expiresAt < Date.now()) preparedDownloads.delete(existingToken);
        }
        const token = randomUUID();
        preparedDownloads.set(token, { body, expiresAt: Date.now() + 5 * 60 * 1000 });
        return json(res, 200, { downloadUrl: `/api/export/download/${token}` });
      }
      if (req.method === "GET" && requestUrl.pathname.startsWith("/api/export/download/")) {
        const token = requestUrl.pathname.slice("/api/export/download/".length);
        const prepared = preparedDownloads.get(token);
        if (!prepared || prepared.expiresAt < Date.now()) return json(res, 404, { error: "This download link has expired. Build the CSV file again." });
        res.writeHead(200, {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": 'attachment; filename="question-bank.csv"',
          "Content-Length": prepared.body.length,
          "Cache-Control": "no-store"
        });
        return res.end(prepared.body);
      }
      if (req.method === "GET") return serveStatic(req, res);
      json(res, 404, { error: "Not found" });
    } catch (error) {
      json(res, 400, { error: error.message || "Request failed" });
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  createServer().listen(port, "127.0.0.1", () => {
    console.log(`Question Harvester is running at http://127.0.0.1:${port}`);
  });
}
