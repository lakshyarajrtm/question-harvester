# Question Harvester

A local web application that extracts MCQs and coding-question content from permitted public URLs, pasted text, or JSON; lets you review the results; and exports a UTF-8 CSV question bank with the required schema.

The export columns are fixed in this exact order: `question`, `option_a`, `option_b`, `option_c`, `option_d`, `correct_option`, `marks`, `topic`, `difficulty`.

## Start (macOS)

Install Node.js 20 or newer, then double-click `start.command`. Your browser will open the application automatically. Keep its Terminal window open while using the app.

This workspace folder is the live copy of the application. Future changes are applied here directly—there is no need to download or extract another ZIP. Server changes restart automatically, and the browser shows an **Update now** banner when a refresh is needed.

## Start from a terminal

```bash
npm start
```

Then open `http://127.0.0.1:4173`.

The project has no paid services, API keys, or third-party package dependencies.

## Supported input

- Built-in MMLU academic catalog with standardized core subjects and user-selected Easy, Medium, or Hard labels
- Built-in Open Trivia DB catalog with category, difficulty, quantity, and marks controls
- Public HTML pages (best for simple, server-rendered question pages)
- Pasted text using `A.`, `B.`, `C.`, `D.` and `Answer:` conventions
- Saved `.html`, `.txt`, or `.json` files loaded from the source row
- JSON arrays, or objects containing a `questions`, `items`, or `data` array
- Coding pages with headings such as `Problem Statement`, `Input Format`, `Output Format`, `Constraints`, and `Examples`

Dynamic sites that require JavaScript, authentication, CAPTCHAs, or anti-bot workarounds are intentionally unsupported. Always confirm that you have permission to access and reuse source content.

If a URL reports HTTP 403, the website is requiring browser verification. Click **Open page**, complete the site's verification normally, select and copy the question text, return to the app, and click **Paste copied text**. You can also use **Load file** with a saved page.

## JSON example

```json
[
  {
    "question": "Which data structure uses FIFO ordering?",
    "option_a": "Stack",
    "option_b": "Queue",
    "option_c": "Tree",
    "option_d": "Graph",
    "correct_option": "B",
    "marks": 1,
    "difficulty": "Easy",
    "topic": "Data Structures"
  }
]
```
