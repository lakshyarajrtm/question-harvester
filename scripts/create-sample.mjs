import fs from "node:fs/promises";
import path from "node:path";
import { createCsvBuffer } from "../server.mjs";

const outputDir = path.resolve("outputs");
await fs.mkdir(outputDir, { recursive: true });
const questions = [
  { question:"Which data structure uses FIFO ordering?", option_a:"Stack", option_b:"Queue", option_c:"Tree", option_d:"Graph", correct_option:"B", marks:1, topic:"Data Structures", difficulty:"Easy" },
  { question:"Two Sum\n\nProblem Statement:\nReturn the indices of two values whose sum equals the target.\n\nInput Format:\nAn integer array and a target integer.\n\nOutput Format:\nTwo zero-based indices.\n\nConstraints:\n2 <= n <= 10^4\n\nExample:\n[2,7,11,15], target=9 -> [0,1]", option_a:"", option_b:"", option_c:"", option_d:"", correct_option:"", marks:5, topic:"Arrays", difficulty:"Easy" }
];
const csv = createCsvBuffer(questions);
await fs.writeFile(path.join(outputDir,"question-bank-sample.csv"), csv);
console.log(`Created question-bank-sample.csv (${csv.length} bytes)`);
