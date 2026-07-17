const defaultColumns = [
  "question","option_a","option_b","option_c","option_d","correct_option","marks","topic","difficulty"
];
const fields = [
  ["question","Question","wide"],["option_a","Option A"],["option_b","Option B"],["option_c","Option C"],["option_d","Option D"],["correct_option","Correct option"],["marks","Marks"],["topic","Topic"],["difficulty","Difficulty"]
];
let questions = [];
const $ = (selector, root=document) => root.querySelector(selector);
const catalogOptions = {
  mmlu: {
    categories: [["computer_science","Computer Science"],["programming_fundamentals","Programming Fundamentals"],["networking","Networking"],["operating_systems","Operating Systems"],["dbms","DBMS"],["data_structures","Data Structures"],["algorithms","Algorithms"],["object_oriented_programming","Object-Oriented Programming"],["computer_architecture","Computer Architecture"],["cybersecurity","Cybersecurity"],["ai_machine_learning","AI & Machine Learning"],["software_engineering","Software Engineering"],["theory_of_computation","Theory of Computation"],["compiler_design","Compiler Design"],["mathematics","Mathematics"],["analytical_reasoning","Analytical Reasoning"]],
    difficulties: [["easy","Easy"],["medium","Medium"],["hard","Hard"]],
    license: 'Academic questions are supplied by <a href="https://huggingface.co/datasets/cais/mmlu" target="_blank" rel="noopener">MMLU</a> under the MIT License. MMLU has no difficulty metadata; your selected difficulty label is applied to the imported rows.'
  },
  opentdb: {
    categories: [["18","Computer Science"],["19","Mathematics"],["17","Science"],["9","General Knowledge"],["22","Geography"],["23","History"],["24","Politics"],["21","Sports"]],
    difficulties: [["easy","Easy"],["medium","Medium"],["hard","Hard"]],
    license: 'Questions are supplied by <a href="https://opentdb.com/" target="_blank" rel="noopener">Open Trivia DB</a> under <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener">CC BY-SA 4.0</a>.'
  }
};

function setSelectOptions(select, options) {
  select.innerHTML="";
  options.forEach(([value,label])=>{ const option=document.createElement("option"); option.value=value; option.textContent=label; select.append(option); });
}

function updateCatalogProvider() {
  const provider=$("#catalogProvider").value;
  const config=catalogOptions[provider];
  const previousDifficulty=$("#catalogDifficulty").value;
  setSelectOptions($("#catalogCategory"),config.categories);
  setSelectOptions($("#catalogDifficulty"),config.difficulties);
  $("#catalogDifficulty").value=config.difficulties.some(([value])=>value===previousDifficulty) ? previousDifficulty : "medium";
  $("#catalogDifficulty").disabled=false;
  $("#catalogLicense").innerHTML=config.license;
}

function addSource(mode="url", value="", type="auto") {
  const node = $("#sourceTemplate").content.firstElementChild.cloneNode(true);
  $(".source-mode", node).value = mode;
  $(".source-type", node).value = type;
  $(".source-value", node).value = value;
  const update = () => { $(".source-value", node).placeholder = $(".source-mode", node).value === "url" ? "https://example.com/questions" : "Paste page text or a JSON array of questions"; };
  $(".source-mode", node).addEventListener("change", update);
  $(".open-page", node).addEventListener("click", () => {
    const value=$(".source-value", node).value.trim();
    if(!/^https?:\/\//i.test(value)) {
      $("#status").className="error";
      $("#status").textContent="Enter a public URL before clicking Open page.";
      return;
    }
    window.open(value,"_blank","noopener");
    $("#status").className="";
    $("#status").textContent="Complete any website verification, select and copy the question text, then return and click Paste copied text.";
  });
  $(".paste-text", node).addEventListener("click", async () => {
    try {
      const copied=await navigator.clipboard.readText();
      if(!copied.trim()) throw new Error("Your clipboard does not contain text.");
      $(".source-mode", node).value="text";
      $(".source-value", node).value=copied;
      update();
      $("#status").className="";
      $("#status").textContent="Copied text loaded. Click Extract questions.";
    } catch(error) {
      $("#status").className="error";
      $("#status").textContent=`Could not read copied text: ${error.message} You can select Pasted text / JSON and paste manually.`;
    }
  });
  $(".load-file", node).addEventListener("click", () => $(".source-file", node).click());
  $(".source-file", node).addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 4 * 1024 * 1024) {
      $("#status").className="error";
      $("#status").textContent="The selected file is larger than 4 MB.";
      event.target.value="";
      return;
    }
    $(".source-mode", node).value="text";
    $(".source-value", node).value=await file.text();
    update();
    $("#status").className="";
    $("#status").textContent=`Loaded ${file.name}. Click Extract questions.`;
  });
  $(".remove-source", node).addEventListener("click", () => node.remove());
  update();
  $("#sources").append(node);
}

function blankQuestion() {
  return { question:"", option_a:"", option_b:"", option_c:"", option_d:"", correct_option:"", marks:1, topic:"", difficulty:"" };
}

function renderQuestions() {
  const host = $("#questions");
  $("#questionCount").textContent = questions.length;
  if (!questions.length) { host.className="empty"; host.textContent="Extract a source or add a blank question to begin."; return; }
  host.className=""; host.innerHTML="";
  questions.forEach((question, index) => {
    const card = document.createElement("article"); card.className="question-card";
    const head = document.createElement("div"); head.className="card-head"; head.innerHTML=`<strong>Question ${index+1}</strong><button class="secondary">Remove</button>`;
    $("button", head).addEventListener("click", () => { questions.splice(index,1); renderQuestions(); });
    const grid = document.createElement("div"); grid.className="field-grid";
    fields.forEach(([key,label,width]) => {
      const wrapper=document.createElement("div"); wrapper.className=`field ${width||""}`;
      const lab=document.createElement("label"); lab.textContent=label;
      let control;
      control=document.createElement(key === "question" ? "textarea" : "input");
      if(control.tagName === "TEXTAREA") control.rows=5;
      if(key === "marks") { control.type="number"; control.min="0"; control.step="1"; }
      control.value=question[key] ?? "";
      control.addEventListener("input", () => { question[key]=control.value; });
      wrapper.append(lab,control); grid.append(wrapper);
    });
    card.append(head,grid); host.append(card);
  });
}

function renderColumns() {
  const host=$("#columns"); host.innerHTML="";
  defaultColumns.forEach((column,index) => {
    const row=document.createElement("div"); row.className="column-row";
    const number=document.createElement("span"); number.className="column-number"; number.textContent=String(index+1).padStart(2,"0");
    const name=document.createElement("code"); name.textContent=column;
    row.append(number,name); host.append(row);
  });
}

async function extract() {
  const sources=[...document.querySelectorAll(".source-row")].map(row=>({ mode:$(".source-mode",row).value, type:$(".source-type",row).value, value:$(".source-value",row).value.trim() })).filter(item=>item.value);
  if (!sources.length) { $("#status").textContent="Add at least one URL or pasted-text source."; return; }
  $("#status").className=""; $("#status").textContent="Extracting…"; $("#extract").disabled=true;
  try {
    const response=await fetch("/api/extract",{ method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({sources}) });
    const result=await response.json(); if(!response.ok) throw new Error(result.error || "Extraction failed");
    questions.push(...result.questions); renderQuestions();
    const failed=result.errors?.length ? ` ${result.errors.length} source(s) could not be read: ${result.errors.map(e=>e.error).join("; ")}` : "";
    $("#status").className=result.errors?.length?"error":""; $("#status").textContent=`Added ${result.questions.length} question(s). Review them before exporting.${failed}`;
  } catch(error) { $("#status").className="error"; $("#status").textContent=error.message; }
  finally { $("#extract").disabled=false; }
}

async function importCatalog() {
  const button=$("#importCatalog");
  button.disabled=true; button.textContent="Getting MCQs…";
  $("#status").className=""; $("#status").textContent="Requesting licensed questions…";
  try {
    const provider=$("#catalogProvider").value;
    const payload={
      category:$("#catalogCategory").value,
      topic:$("#catalogCategory").value,
      difficulty:$("#catalogDifficulty").value,
      amount:$("#catalogAmount").value,
      marks:$("#catalogMarks").value
    };
    const response=await fetch(`/api/catalog/${provider}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
    const result=await response.json();
    if(!response.ok) throw new Error(result.error || "Catalog request failed");
    questions.push(...result.questions); renderQuestions();
    const providerName=provider === "mmlu" ? "MMLU" : "Open Trivia DB";
    $("#status").textContent=`Added ${result.questions.length} licensed MCQ(s) from ${providerName}. Review them before exporting.`;
  } catch(error) {
    $("#status").className="error"; $("#status").textContent=error.message;
  } finally {
    button.disabled=false; button.textContent="Get MCQs";
  }
}

async function exportCsv() {
  if (!questions.length) { $("#status").className="error"; $("#status").textContent="Add at least one question before exporting."; return; }
  const button=$("#export"); button.disabled=true; button.textContent="Building CSV…";
  try {
    const response=await fetch("/api/export/prepare",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({questions})});
    if(!response.ok) { const result=await response.json(); throw new Error(result.error||"Export failed"); }
    const {downloadUrl}=await response.json();
    const anchor=document.createElement("a");
    anchor.href=downloadUrl;
    anchor.download="question-bank.csv";
    anchor.className="download-link";
    anchor.textContent="Download question-bank.csv";
    $("#status").className="download-success";
    $("#status").replaceChildren(document.createTextNode("CSV is ready. "),anchor,document.createTextNode(" If it did not start automatically, click the link."));
    anchor.click();
  } catch(error) { $("#status").className="error"; $("#status").textContent=error.message; }
  finally { button.disabled=false; button.textContent="Download CSV"; }
}

$("#addSource").addEventListener("click",()=>addSource());
$("#addQuestion").addEventListener("click",()=>{ questions.push(blankQuestion()); renderQuestions(); });
$("#extract").addEventListener("click",extract);
$("#importCatalog").addEventListener("click",importCatalog);
$("#catalogProvider").addEventListener("change",updateCatalogProvider);
$("#export").addEventListener("click",exportCsv);
$("#applyUpdate").addEventListener("click",()=>location.reload());

let runningVersion="";
async function checkForUpdates() {
  try {
    const response=await fetch(`/api/version?time=${Date.now()}`,{cache:"no-store"});
    if(!response.ok) return;
    const {version}=await response.json();
    if(!runningVersion) runningVersion=version;
    else if(version !== runningVersion) $("#updateBanner").hidden=false;
  } catch {
    // A brief failure is expected while the watched server restarts.
  }
}

updateCatalogProvider(); addSource(); renderQuestions(); renderColumns();
checkForUpdates();
setInterval(checkForUpdates,3000);
