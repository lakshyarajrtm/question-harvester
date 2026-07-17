import assert from "node:assert/strict";
import test from "node:test";
import { createCsvBuffer, createServer, extractQuestions, mapMmluQuestions, mapOpenTriviaQuestions } from "../server.mjs";

test("extracts multiple MCQs from pasted text", () => {
  const input = `
1. What is 2 + 2?
A. 3
B. 4
C. 5
D. 6
Answer: B

2. Which color is made by mixing blue and yellow?
A. Purple
B. Orange
C. Green
D. Red
Correct Answer: C`;
  const rows = extractQuestions(input, "https://example.com/quiz", "MCQ");
  assert.equal(rows.length, 2);
  assert.equal(rows[0].option_b, "4");
  assert.equal(rows[1].correct_option, "C");
});

test("extracts coding sections", () => {
  const input = `Two Sum
Problem Statement:
Find two values that add to the target.
Input Format:
An array and an integer target.
Output Format:
Two indices.
Constraints:
2 <= n <= 10000
Example:
[2,7], 9 -> [0,1]`;
  const [row] = extractQuestions(input, "https://example.com/code", "Coding");
  assert.match(row.question, /^Two Sum/);
  assert.match(row.question, /Input Format:[\s\S]*array/);
  assert.match(row.question, /Constraints:[\s\S]*10000/);
});

test("exports a downloadable CSV file with exact columns and safe escaping", () => {
  const buffer = createCsvBuffer([{ question: "Which value is \"quoted\", or split\nacross lines?", option_a: "=2+2", option_b: "B", option_c: "C", option_d: "D", correct_option: "A", marks: 1, topic: "Networking", difficulty: "Easy" }]);
  assert.equal(Buffer.isBuffer(buffer), true);
  const csv = buffer.toString("utf8").replace(/^\uFEFF/, "");
  assert.equal(csv.split("\r\n")[0], '"question","option_a","option_b","option_c","option_d","correct_option","marks","topic","difficulty"');
  assert.match(csv, /"Which value is ""quoted"", or split\nacross lines\?"/);
  assert.match(csv, /"'=2\+2"/);
});

test("maps Open Trivia DB questions into the required schema", () => {
  const [row] = mapOpenTriviaQuestions([{
    category: "Science: Computers",
    type: "multiple",
    difficulty: "medium",
    question: "What does SQL stand for?",
    correct_answer: "Structured Query Language",
    incorrect_answers: ["Simple Query Logic", "System Queue Language", "Structured Question List"]
  }], 2);
  assert.equal(row.question, "What does SQL stand for?");
  assert.equal(row.marks, 2);
  assert.equal(row.topic, "Computer Science");
  assert.equal(row.difficulty, "Medium");
  assert.match(row.correct_option, /^[A-D]$/);
  assert.equal([row.option_a,row.option_b,row.option_c,row.option_d].includes("Structured Query Language"), true);
});

test("maps MMLU rows into the required schema", () => {
  const [row] = mapMmluQuestions([{ row: {
    question: "Which data structure follows FIFO order?",
    subject: "college_computer_science",
    choices: ["Stack", "Queue", "Tree", "Heap"],
    answer: 1
  }}], 3, "Operating Systems", "Hard");
  assert.equal(row.question, "Which data structure follows FIFO order?");
  assert.equal(row.option_b, "Queue");
  assert.equal(row.correct_option, "B");
  assert.equal(row.marks, 3);
  assert.equal(row.topic, "Operating Systems");
  assert.equal(row.difficulty, "Hard");
});

test("serves extraction API for pasted content", async (t) => {
  const server = createServer();
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
  } catch (error) {
    if (error.code === "EPERM") {
      t.skip("The execution sandbox does not permit local listening sockets.");
      return;
    }
    throw error;
  }
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/extract`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sources: [{ mode: "text", type: "MCQ", value: "What is 1+1?\nA. 1\nB. 2\nAnswer: B" }] })
    });
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.equal(result.questions.length, 1);
    assert.equal(result.questions[0].marks, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
