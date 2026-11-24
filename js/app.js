/* LangStudy – a static, no-build study app for German and Italian.
 * All progress lives in localStorage under STORAGE_KEY; Export/Import moves it between devices.
 */
(function () {
  "use strict";

  // ------------------------------------------------------------------ config
  var STORAGE_KEY = "langstudy.v1";
  var LANGS = {
    de: { file: "data/german.json", label: "Deutsch" },
    it: { file: "data/italian.json", label: "Italiano" }
  };
  var REVIEW_STEPS = [1, 3, 7]; // days until the next review after each success
  var TYPE_LABEL = { fill: "Fill in", transform: "Rewrite", translate: "Translate", write: "Write", reading: "Read" };

  var DATA = {};      // lang -> course JSON
  var S = null;       // persistent state
  var reviewSession = {}; // key -> {answer, result, how} for the current page visit only
  var snaps = {};         // review key -> review entry as it was before this page visit changed it
  var reviewFilter = "unit";

  // ------------------------------------------------------------------ utils
  function $(sel, root) { return (root || document).querySelector(sel); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function dateKey(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function today() { return dateKey(new Date()); }
  function addDays(key, n) {
    var p = key.split("-");
    var d = new Date(+p[0], +p[1] - 1, +p[2]);
    d.setDate(d.getDate() + n);
    return dateKey(d);
  }
  function prettyDate(key) {
    var p = key.split("-");
    return new Date(+p[0], +p[1] - 1, +p[2]).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  }
  function shortDate(key) {
    var p = key.split("-");
    return new Date(+p[0], +p[1] - 1, +p[2]).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  }
  var toastTimer;
  function toast(msg) {
    var t = $("#toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove("show"); }, 3200);
  }

  // ------------------------------------------------------------------ state
  function defaultState() {
    return {
      version: 1,
      theme: "auto",
      lenient: true,
      langs: { de: { units: {}, drafts: {} }, it: { units: {}, drafts: {} } },
      review: {}
    };
  }
  function normalizeState(s) {
    var d = defaultState();
    if (!s || typeof s !== "object") return d;
    s.version = 1;
    if (["auto", "light", "dark"].indexOf(s.theme) < 0) s.theme = "auto";
    if (typeof s.lenient !== "boolean") s.lenient = true;
    s.langs = s.langs || {};
    ["de", "it"].forEach(function (l) {
      s.langs[l] = s.langs[l] || {};
      s.langs[l].units = s.langs[l].units || {};
      s.langs[l].drafts = s.langs[l].drafts || {};
    });
    s.review = s.review || {};
    return s;
  }
  function load() {
    try { S = normalizeState(JSON.parse(localStorage.getItem(STORAGE_KEY))); }
    catch (e) { S = defaultState(); }
  }
  var saveTimer, dirty = false;
  function save() {
    clearTimeout(saveTimer);
    dirty = false;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(S)); }
    catch (e) { toast("Could not save progress in this browser. Use Export to keep a backup."); }
  }
  function saveSoon() { dirty = true; clearTimeout(saveTimer); saveTimer = setTimeout(save, 400); }
  function flush() { if (dirty) save(); }

  function uState(lang, uid) {
    var units = S.langs[lang].units;
    if (!units[uid]) units[uid] = { practice: {}, attempts: [] };
    return units[uid];
  }
  function peekU(lang, uid) { return S.langs[lang].units[uid]; }

  // ------------------------------------------------------------------ course helpers
  function units(lang) { return DATA[lang].units; }
  function unitIndex(lang, uid) {
    var us = units(lang);
    for (var i = 0; i < us.length; i++) if (us[i].id === uid) return i;
    return -1;
  }
  function getUnit(lang, uid) { return units(lang)[unitIndex(lang, uid)]; }

  // Returns {item, passage} for practice ids (p3, p9b) and test ids (t2).
  function getItem(lang, uid, id) {
    var u = getUnit(lang, uid);
    if (!u) return null;
    var list = id.charAt(0) === "t" ? u.test : u.practice;
    for (var i = 0; i < list.length; i++) {
      var ex = list[i];
      if (ex.id === id) return { item: ex, passage: null };
      if (ex.type === "reading") {
        for (var j = 0; j < ex.questions.length; j++) {
          if (ex.questions[j].id === id) return { item: ex.questions[j], passage: ex, reading: true };
        }
      }
    }
    return null;
  }
  function flatTest(u) { return u.test; }

  function bestScore(lang, uid) {
    var us = peekU(lang, uid);
    if (!us || !us.attempts.length) return null;
    return Math.max.apply(null, us.attempts.map(function (a) { return a.score; }));
  }
  function isDone(lang, uid) {
    var us = peekU(lang, uid);
    if (!us || !us.attempts.length) return false;
    if (DATA[lang].progression === "score") return bestScore(lang, uid) >= DATA[lang].passMark;
    return true; // Italian: any submitted attempt
  }
  function hasActivity(lang, uid) {
    var us = peekU(lang, uid);
    if (S.langs[lang].drafts[uid]) return true;
    if (!us) return false;
    return us.attempts.length > 0 || Object.keys(us.practice).some(function (k) { return us.practice[k].result; });
  }
  function currentIndex(lang) {
    var us = units(lang);
    for (var i = 0; i < us.length; i++) if (!isDone(lang, us[i].id)) return i;
    return us.length;
  }
  function status(lang, uid) {
    if (isDone(lang, uid)) return "done";
    var i = unitIndex(lang, uid), c = currentIndex(lang);
    if (i === c) return hasActivity(lang, uid) ? "in-progress" : "current";
    return "locked";
  }
  var STATUS_LABEL = { done: "Done", "in-progress": "In progress", current: "Current", locked: "Locked" };

  // ------------------------------------------------------------------ answer checking
  function baseNorm(s) {
    return String(s || "")
      .normalize("NFC")
      .toLowerCase()
      .replace(/[’‘`´]/g, "'")
      .replace(/[.,!?;:"“”„«»()\[\]–—…→]/g, " ")
      .replace(/(^|\s)-+(?=\s|$)/g, " ")
      .replace(/\s*'\s*/g, "'")
      .replace(/\s+/g, " ")
      .trim();
  }
  function stripMarks(s) {
    return s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ß/g, "ss");
  }
  function transliterate(s) { // ae/oe/ue typed instead of ä/ö/ü
    return s.replace(/ae/g, "ä").replace(/oe/g, "ö").replace(/ue/g, "ü");
  }
  // Returns "exact", "lenient" or "wrong".
  function checkAnswer(user, item) {
    var u = baseNorm(user);
    if (!u) return "wrong";
    var accepted = [item.answer].concat(item.alternatives || []).map(baseNorm);
    if (accepted.indexOf(u) >= 0) return "exact";
    if (!S.lenient) return "wrong";
    var cands = [stripMarks(u), stripMarks(transliterate(u))];
    for (var i = 0; i < accepted.length; i++) {
      var a = stripMarks(accepted[i]);
      if (cands.indexOf(a) >= 0) return "lenient";
    }
    return "wrong";
  }

  // ------------------------------------------------------------------ review (spaced repetition)
  function rKey(lang, uid, id) { return lang + "|" + uid + "|" + id; }
  function scheduleWrong(lang, uid, id) {
    var k = rKey(lang, uid, id), t = today();
    var r = S.review[k];
    if (!r) S.review[k] = { lang: lang, unit: uid, item: id, step: 0, due: addDays(t, 1), added: t, last: t };
    else { r.step = 0; r.due = addDays(t, 1); r.last = t; }
  }
  function reviewSuccess(k) {
    var r = S.review[k];
    if (!r) return "gone";
    var t = today();
    r.last = t;
    if (r.step >= REVIEW_STEPS.length - 1) { delete S.review[k]; return "mastered"; }
    r.step += 1;
    r.due = addDays(t, REVIEW_STEPS[r.step]);
    return r.due;
  }
  // A verdict can be changed during one page visit (re-check, "my answer is also correct", re-marking).
  // We remember the review entry as it was before the first change and re-apply from there each time.
  function snapshot(k) { if (!(k in snaps)) snaps[k] = S.review[k] ? JSON.parse(JSON.stringify(S.review[k])) : null; }
  function restore(k) {
    if (!(k in snaps)) return;
    if (snaps[k]) S.review[k] = JSON.parse(JSON.stringify(snaps[k])); else delete S.review[k];
  }
  function applyVerdict(mode, lang, uid, id, result) {
    var k = rKey(lang, uid, id);
    snapshot(k);
    restore(k);
    if (mode === "review" && result === "correct") return reviewSuccess(k);
    if (result === "partly" || result === "wrong") scheduleWrong(lang, uid, id);
    return null;
  }
  function dueItems(lang, uid) {
    var t = today();
    return Object.keys(S.review).filter(function (k) {
      var r = S.review[k];
      return r.lang === lang && (!uid || r.unit === uid) && r.due <= t && getItem(r.lang, r.unit, r.item);
    }).sort(function (a, b) {
      var ra = S.review[a], rb = S.review[b];
      return ra.due < rb.due ? -1 : ra.due > rb.due ? 1 : (a < b ? -1 : 1);
    });
  }
  function upcomingCount(lang, uid) {
    var t = today();
    return Object.keys(S.review).filter(function (k) {
      var r = S.review[k];
      return r.lang === lang && (!uid || r.unit === uid) && r.due > t;
    }).length;
  }

  // ------------------------------------------------------------------ speech
  var TTS = { supported: "speechSynthesis" in window && "SpeechSynthesisUtterance" in window, voices: {} };
  function refreshVoices() {
    if (!TTS.supported) return;
    var vs = window.speechSynthesis.getVoices() || [];
    ["de", "it"].forEach(function (l) {
      var want = DATA[l] ? DATA[l].speechLang : (l === "de" ? "de-DE" : "it-IT");
      var exact = vs.filter(function (v) { return v.lang && v.lang.replace("_", "-").toLowerCase() === want.toLowerCase(); });
      var loose = vs.filter(function (v) { return v.lang && v.lang.toLowerCase().indexOf(l) === 0; });
      TTS.voices[l] = exact[0] || loose[0] || null;
      document.body.classList.toggle("tts-" + l, !!TTS.voices[l]);
    });
  }
  function speak(text, lang) {
    if (!TTS.supported || !TTS.voices[lang]) return;
    var synth = window.speechSynthesis;
    synth.cancel();
    var u = new SpeechSynthesisUtterance(text.replace(/[–—]/g, ","));
    u.voice = TTS.voices[lang];
    u.lang = TTS.voices[lang].lang || DATA[lang].speechLang;
    u.rate = 0.9;
    synth.speak(u);
  }
  function speakBtn(text, lang, label) {
    return '<button class="speak" type="button" data-action="speak" data-lang="' + lang + '" data-text="' + esc(text) +
      '" aria-label="' + esc(label || "Listen") + '" title="Listen">🔊</button>';
  }

  // ------------------------------------------------------------------ clipboard prompt
  function instructionFor(lang, item) {
    if (item.instruction) return item.instruction;
    var name = DATA[lang].language;
    switch (item.type) {
      case "translate": return "Translate into " + name + ".";
      case "fill": return "Fill in the blank.";
      case "write": return "Write in " + name + ".";
      default: return "Answer in English or " + name + ".";
    }
  }
  function claudePrompt(lang, uid, id, answer) {
    var c = DATA[lang], u = getUnit(lang, uid), found = getItem(lang, uid, id);
    var item = found.item;
    var lines = [];
    lines.push("I'm a self-learner studying " + c.language + " (goal: " + c.goal + ", " + c.examDate + "). Please correct my answer to this exercise.");
    lines.push("");
    lines.push("Unit " + (unitIndex(lang, uid) + 1) + ": " + u.title + " (" + u.level + ")");
    if (found.reading) {
      lines.push("Exercise: reading comprehension – \"" + found.passage.title + "\"");
      lines.push("Passage:");
      lines.push(found.passage.passage);
      lines.push("");
      lines.push("Question: " + item.prompt);
    } else {
      lines.push("Exercise (" + (TYPE_LABEL[item.type] || item.type) + "): " + instructionFor(lang, item));
      lines.push("Task: " + item.prompt);
    }
    lines.push("");
    lines.push("My answer: " + (answer && answer.trim() ? answer.trim() : "(I haven't answered yet – please give me hints first)"));
    lines.push("Model answer: " + item.answer);
    if (item.alternatives && item.alternatives.length) lines.push("Also accepted: " + item.alternatives.join(" | "));
    lines.push("");
    lines.push("Please:");
    lines.push("1. Tell me whether my answer is correct, partly correct or wrong. It may differ from the model answer and still be right.");
    lines.push("2. List each correction with a short explanation in English.");
    lines.push("3. Give a corrected version of my answer, staying close to what I wrote.");
    if (lang === "it") lines.push("Please keep explanations at A1–A2 level.");
    return lines.join("\n");
  }
  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return fallbackCopy(text); });
    }
    return Promise.resolve(fallbackCopy(text));
  }
  function fallbackCopy(text) {
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "-1000px";
    document.body.appendChild(ta);
    ta.select();
    var ok = false;
    try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    return ok;
  }

  // ------------------------------------------------------------------ exercise cards
  // mode: "practice" | "review" | "test"
  function cardKey(mode, lang, uid, id) { return [mode, lang, uid, id].join("|"); }

  function entryFor(mode, lang, uid, id) {
    if (mode === "practice") return uState(lang, uid).practice[id] || {};
    if (mode === "review") return reviewSession[rKey(lang, uid, id)] || {};
    var d = S.langs[lang].drafts[uid];
    if (!d) return {};
    var m = (d.marks && d.marks[id]) || {};
    return { answer: d.answers[id] || "", result: m.result, how: m.how, submitted: d.submitted, revealed: d.submitted };
  }

  function feedbackHTML(mode, lang, uid, id, item, e) {
    if (!e.result && !(e.revealed)) return "";
    var self = item.check === "self";
    var h = "";
    var alts = item.alternatives && item.alternatives.length
      ? '<div class="small muted">Also accepted: ' + item.alternatives.map(esc).join(" · ") + "</div>" : "";
    if (!self) {
      if (e.result === "correct" && e.how === "exact") {
        h = '<div class="fb correct"><span class="verdict">✓ Correct.</span>' +
          (baseNorm(e.answer) !== baseNorm(item.answer) ? '<div>Model answer: <span class="model">' + esc(item.answer) + "</span></div>" : "") + "</div>";
      } else if (e.result === "correct" && e.how === "lenient") {
        h = '<div class="fb lenient"><span class="verdict">✓ Correct, but check your umlauts/accents.</span>' +
          '<div>Exact spelling: <span class="model">' + esc(item.answer) + "</span></div></div>";
      } else if (e.result === "correct" && e.how === "override") {
        h = '<div class="fb correct"><span class="verdict">✓ Counted as correct (your call).</span>' +
          '<div>Model answer: <span class="model">' + esc(item.answer) + "</span></div>" + alts + "</div>";
      } else {
        h = '<div class="fb wrong"><span class="verdict">✗ Not quite.</span>' +
          '<div>Model answer: <span class="model">' + esc(item.answer) + "</span></div>" + alts +
          (mode !== "test" || e.submitted ? '<div class="btn-row"><button class="btn small" data-action="override">My answer is also correct</button></div>' : "") +
          "</div>";
      }
      return h;
    }
    // self-marked
    var sel = function (r) { return (e.result === r ? " sel-" + r : "") + '" aria-pressed="' + (e.result === r); };
    h = '<div class="compare">' +
      '<div><h4>Your answer</h4><div class="txt">' + (e.answer && e.answer.trim() ? esc(e.answer) : '<span class="muted">(empty)</span>') + "</div></div>" +
      '<div><h4>Model answer</h4><div class="txt">' + esc(item.answer) + "</div></div></div>" +
      '<div class="small muted mark-hint">How did you do? Mark it honestly – partly and wrong answers come back for review tomorrow.</div>' +
      '<div class="btn-row seg" role="group" aria-label="Mark your answer">' +
      '<button class="btn small' + sel("correct") + '" data-action="mark" data-value="correct">✓ Correct</button>' +
      '<button class="btn small' + sel("partly") + '" data-action="mark" data-value="partly">~ Partly</button>' +
      '<button class="btn small' + sel("wrong") + '" data-action="mark" data-value="wrong">✗ Wrong</button>' +
      "</div>";
    return h;
  }

  function renderCard(mode, lang, uid, id, opts) {
    opts = opts || {};
    var found = getItem(lang, uid, id);
    if (!found) return "";
    var item = found.item;
    var e = entryFor(mode, lang, uid, id);
    var self = item.check === "self";
    var locked = mode === "test" && e.submitted;
    var head = "";
    if (found.reading) {
      head = '<div class="ex-head"><span class="tag">Reading</span><span class="ins">Answer in English.</span>';
    } else {
      head = '<div class="ex-head"><span class="tag">' + esc(TYPE_LABEL[item.type] || item.type) + '</span><span class="ins">' + esc(instructionFor(lang, item)) + "</span>";
    }
    if (mode === "practice" && e.result) head += '<span class="badge-last ' + e.result + '">Last: ' + e.result + "</span>";
    head += "</div>";
    var context = "";
    if (opts.showUnit) {
      var u = getUnit(lang, uid);
      context = '<div class="small muted">Unit ' + (unitIndex(lang, uid) + 1) + " · " + esc(u.title) + "</div>";
    }
    if (found.reading && opts.showPassage) {
      context += '<details class="passage-ref"><summary>Show the passage: ' + esc(found.passage.title) + "</summary>" +
        '<div class="passage">' + esc(found.passage.passage) + "</div></details>";
    }
    var promptHTML = '<div class="prompt">' + esc(item.prompt) + "</div>";
    var input;
    var placeholder = self ? (found.reading ? "Your answer in English…" : "Write your answer…") : "Your answer";
    if (self) {
      input = '<textarea class="answer-input" data-field="answer" rows="4" placeholder="' + placeholder + '" aria-label="Your answer"' + (locked ? " disabled" : "") + ">" + esc(e.answer || "") + "</textarea>";
    } else {
      input = '<input class="answer-input" data-field="answer" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="' + placeholder + '" aria-label="Your answer" value="' + esc(e.answer || "") + '"' + (locked ? " disabled" : "") + ">";
    }
    var buttons = "";
    if (mode !== "test") {
      buttons = '<div class="btn-row"><button class="btn primary" data-action="check">' + (self ? "Show model answer" : "Check") + "</button>" +
        '<button class="btn quiet" data-action="ask">Ask Claude to correct</button></div>';
    } else if (e.submitted) {
      buttons = '<div class="btn-row"><button class="btn small quiet" data-action="ask">Ask Claude to correct</button></div>';
    }
    var fb = mode === "test" && !e.submitted ? "" : feedbackHTML(mode, lang, uid, id, item, e);
    return '<div class="card ex" data-card="' + esc(cardKey(mode, lang, uid, id)) + '">' + context + head + promptHTML + input + buttons +
      '<div class="fb-wrap">' + fb + "</div></div>";
  }

  function rerenderCard(el) {
    var p = el.getAttribute("data-card").split("|");
    var opts = { showUnit: el.hasAttribute("data-show-unit"), showPassage: p[0] === "review" };
    var html = renderCard(p[0], p[1], p[2], p[3], opts);
    var tmp = document.createElement("div");
    tmp.innerHTML = html;
    var fresh = tmp.firstChild;
    if (opts.showUnit) fresh.setAttribute("data-show-unit", "");
    el.parentNode.replaceChild(fresh, el);
    return fresh;
  }

  // ------------------------------------------------------------------ views
  function setNav(which) {
    document.querySelectorAll("[data-nav]").forEach(function (a) {
      if (a.getAttribute("data-nav") === which) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });
  }

  function progressHTML(lang) {
    var total = units(lang).length;
    var done = units(lang).filter(function (u) { return isDone(lang, u.id); }).length;
    var pct = Math.round(done / total * 100);
    return '<div class="progress-label"><span>' + done + " of " + total + " units done</span><span>" + pct + "%</span></div>" +
      '<div class="progress" role="progressbar" aria-label="Units done" aria-valuemin="0" aria-valuemax="' + total + '" aria-valuenow="' + done + '"><span style="width:' + pct + '%"></span></div>';
  }

  function todayCard(lang) {
    var c = DATA[lang], ci = currentIndex(lang), us = units(lang);
    var h = '<section class="card today-card" aria-labelledby="tc-' + lang + '">' +
      '<header class="tc-head"><h2 class="tc-lang" id="tc-' + lang + '"><span class="lang-mark" aria-hidden="true">' + lang.toUpperCase() + "</span>" + esc(c.language) + "</h2>" +
      '<span class="tc-goal">' + esc(c.goal) + " · " + esc(c.examDate) + "</span></header>";
    if (ci >= us.length) {
      h += '<div class="tc-unit"><h3 class="tc-title">All units done 🎉</h3><p class="meta">Keep your reviews going and retake tests to push your scores up.</p></div>';
    } else {
      var u = us[ci], st = status(lang, u.id), us0 = peekU(lang, u.id);
      var answered = us0 ? Object.keys(us0.practice).filter(function (k) { return us0.practice[k].result; }).length : 0;
      var totalQ = countPractice(u);
      h += '<div class="tc-unit"><div class="kicker-row"><span class="kicker">Unit ' + (ci + 1) + " of " + us.length + '</span><span class="pill ' + st + '">' + STATUS_LABEL[st] + "</span></div>" +
        '<h3 class="tc-title">' + esc(u.title) + "</h3>" +
        '<p class="meta">' + esc(u.level) + (u.schedule ? " · Syllabus: " + esc(u.schedule) : "") + " · Practice " + answered + "/" + totalQ + "</p></div>";
      if (lang === "it" && hasActivity(lang, u.id)) {
        h += '<div class="note info">Repeat this lesson today: re-read the notes, redo the practice, then take the test when you feel ready. The next unit unlocks once you have attempted this unit\'s test.</div>';
      }
      if (lang === "de" && us0 && us0.attempts.length && !isDone(lang, u.id)) {
        h += '<div class="note warn">Best test score so far: ' + bestScore(lang, u.id) + "%. You need " + c.passMark + "% to finish this unit. Review the weak points, then retake the test.</div>";
      }
      var target = !hasActivity(lang, u.id) ? "" : (answered >= totalQ ? "/test" : "/practice");
      h += '<a class="btn primary block" href="#/' + lang + "/" + u.id + target + '">' + (hasActivity(lang, u.id) ? "Continue" : "Start unit") + ' <span aria-hidden="true">→</span></a>';
    }
    var due = dueItems(lang).length;
    h += '<ul class="tc-status">';
    h += due
      ? '<li class="is-due"><span class="st-icon" aria-hidden="true">↻</span><span><strong>' + due + " review item" + (due === 1 ? "" : "s") + ' due</strong></span><a class="tc-action" href="#/' + lang + "/" + reviewUnit(lang) + '/review?all">Review</a></li>'
      : '<li><span class="st-icon ok" aria-hidden="true">✓</span><span>No reviews due today' + (upcomingCount(lang) ? '<span class="muted"> · ' + upcomingCount(lang) + " coming up later</span>" : "") + "</span></li>";
    if (lang === "de") {
      var drafts = Object.keys(S.langs.de.drafts).length;
      if (drafts) h += '<li class="is-due"><span class="st-icon" aria-hidden="true">✎</span><span><strong>' + drafts + " unfinished test" + (drafts === 1 ? "" : "s") + "</strong></span>" +
        '<a class="tc-action" href="#/de/' + reviewUnit("de") + '/unfinished">Finish</a></li>';
    }
    h += "</ul>";
    h += '<footer class="tc-foot">' + progressHTML(lang) + '<a class="text-link" href="#/' + lang + '">See all units <span aria-hidden="true">→</span></a></footer>';
    return h + "</section>";
  }
  // A unit to host language-wide tabs (Review "all", Unfinished): the current unit, or the last unit when finished.
  function reviewUnit(lang) {
    var us = units(lang), ci = Math.min(currentIndex(lang), us.length - 1);
    return us[ci].id;
  }
  function countPractice(u) {
    var n = 0;
    u.practice.forEach(function (ex) { n += ex.type === "reading" ? ex.questions.length : 1; });
    return n;
  }

  function viewToday() {
    setNav("today");
    var t = today();
    return '<header class="page-head"><p class="eyebrow">' + esc(prettyDate(t)) + "</p><h1>Today</h1></header>" +
      '<div class="today-grid">' + todayCard("de") + todayCard("it") + "</div>" +
      '<p class="tip"><strong>Tip:</strong> wrong and partly-correct answers come back in Review after 1, 3 and 7 days. Use <strong>Ask Claude to correct</strong> on any written answer to get detailed feedback.</p>';
  }

  function viewPath(lang) {
    setNav(lang);
    var c = DATA[lang];
    var h = '<header class="page-head"><p class="eyebrow">' + esc(c.goal) + " · exam " + esc(c.examDate) + "</p><h1>" + esc(c.language) + "</h1>" +
      '<p class="lead">' +
      (c.progression === "score"
        ? "A unit is done when you score " + c.passMark + "% or more on its test; the next unit then unlocks."
        : "The next unit unlocks as soon as you have attempted the current unit's test, whatever the score.") + "</p></header>";
    h += '<div class="card path-progress">' + progressHTML(lang) + "</div>";
    h += '<ol class="path card">';
    units(lang).forEach(function (u, i) {
      var st = status(lang, u.id), best = bestScore(lang, u.id);
      var meta = esc(u.level) + (u.schedule ? " · " + esc(u.schedule) : "") + (best != null ? " · best test " + best + "%" : "");
      var inner = '<span class="dot" aria-hidden="true">' + (st === "done" ? "✓" : (i + 1)) + "</span>" +
        '<span class="path-text"><span class="title">' + esc(u.title) + '</span><span class="meta">' + meta + "</span></span>" +
        '<span class="pill ' + st + '">' + (st === "locked" ? '<span aria-hidden="true">🔒&#xFE0E;&nbsp;</span>' : "") + STATUS_LABEL[st] + "</span>";
      h += '<li class="st-' + st + '">' + (st === "locked"
        ? '<div class="path-row locked-row" data-action="locked" aria-disabled="true"><span class="sr-only">Unit ' + (i + 1) + ": </span>" + inner + "</div>"
        : '<a class="path-row" href="#/' + lang + "/" + u.id + '"' + (st === "current" || st === "in-progress" ? ' aria-current="step"' : "") + '><span class="sr-only">Unit ' + (i + 1) + ": </span>" + inner + "</a>") + "</li>";
    });
    return h + "</ol>";
  }

  function tabLink(lang, uid, tab, label, cur, extra) {
    return '<a href="#/' + lang + "/" + uid + "/" + tab + '"' + (cur === tab ? ' aria-current="page"' : "") + ">" + label + (extra || "") + "</a>";
  }

  function viewUnit(lang, uid, tab) {
    setNav(lang);
    var u = getUnit(lang, uid);
    if (!u) return '<div class="empty">Unit not found. <a href="#/' + lang + '">Back to the unit path</a></div>';
    var st = status(lang, uid), i = unitIndex(lang, uid);
    if (st === "locked" && tab !== "review" && tab !== "unfinished") {
      return '<a class="crumb" href="#/' + lang + '"><span aria-hidden="true">←</span> ' + esc(DATA[lang].language) + " units</a>" +
        '<div class="card empty">🔒 Unit ' + (i + 1) + " is locked. Finish unit " + (currentIndex(lang) + 1) + " first.</div>";
    }
    var dueUnit = dueItems(lang, uid).length;
    var drafts = Object.keys(S.langs[lang].drafts).length;
    var h = '<a class="crumb" href="#/' + lang + '"><span aria-hidden="true">←</span> ' + esc(DATA[lang].language) + " units</a>" +
      '<header class="page-head unit-head"><div class="kicker-row"><span class="kicker">Unit ' + (i + 1) + " · " + esc(u.level) + (u.schedule ? " · " + esc(u.schedule) : "") + '</span><span class="pill ' + st + '">' + STATUS_LABEL[st] + "</span></div>" +
      "<h1>" + esc(u.title) + "</h1></header>";
    h += '<nav class="tabs" aria-label="Unit sections">' +
      tabLink(lang, uid, "study", "Study", tab) +
      tabLink(lang, uid, "practice", "Practice", tab) +
      tabLink(lang, uid, "test", "Test", tab, S.langs[lang].drafts[uid] ? ' <span class="count">!</span>' : "") +
      tabLink(lang, uid, "review", "Review", tab, dueItems(lang).length ? ' <span class="count">' + dueItems(lang).length + "</span>" : "") +
      (lang === "de" ? tabLink(lang, uid, "unfinished", "Unfinished", tab, drafts ? ' <span class="count">' + drafts + "</span>" : "") : "") +
      "</nav>";
    if (tab === "practice") h += tabPractice(lang, u);
    else if (tab === "test") h += tabTest(lang, u);
    else if (tab === "review") h += tabReview(lang, u);
    else if (tab === "unfinished" && lang === "de") h += tabUnfinished(lang);
    else h += tabStudy(lang, u);
    return h;
  }

  function tabStudy(lang, u) {
    var h = '<div class="stack"><p class="lead">' + esc(u.summary) + "</p>";
    u.notes.forEach(function (n) {
      h += '<section class="card page"><h2>' + esc(n.heading) + '</h2><p class="prose">' + esc(n.text) + "</p>";
      if (n.examples && n.examples.length) {
        h += '<ul class="examples">' + n.examples.map(function (ex) {
          return "<li>" + speakBtn(ex.t, lang) + '<div><div class="t">' + esc(ex.t) + '</div><div class="en">' + esc(ex.en) + "</div></div></li>";
        }).join("") + "</ul>";
      }
      h += "</section>";
    });
    h += '<section class="card page"><h2>Vocabulary <span class="count-muted">' + u.vocab.length + '</span></h2><table class="vocab"><tbody>' + u.vocab.map(function (v) {
      return "<tr><td>" + speakBtn(v.term.replace(/\s*\(.*?\)\s*/g, " ").trim(), lang, "Listen: " + v.term) + '</td><td class="term">' + esc(v.term) + '</td><td class="en">' + esc(v.en) + "</td></tr>";
    }).join("") + "</tbody></table></section>";
    h += '<div class="btn-row"><a class="btn primary" href="#/' + lang + "/" + u.id + '/practice">Go to practice <span aria-hidden="true">→</span></a></div>';
    return h + "</div>";
  }

  function readingBlock(lang, ex) {
    var gl = ex.glossary && ex.glossary.length
      ? '<details class="gloss"><summary>Glossary (' + ex.glossary.length + ")</summary><ul>" + ex.glossary.map(function (g) {
        return "<li><strong>" + esc(g.term) + "</strong> – " + esc(g.en) + "</li>";
      }).join("") + "</ul></details>" : "";
    return '<section class="card page ruled"><div class="ex-head"><span class="tag">Read</span><span class="ins">Read the passage, then answer the questions in English.</span></div>' +
      '<h3 class="passage-title">' + speakBtn(ex.passage, lang, "Listen to the passage") + esc(ex.title) + "</h3>" +
      '<div class="passage">' + esc(ex.passage) + "</div>" + gl + "</section>";
  }

  function tabPractice(lang, u) {
    var h = '<div class="stack">';
    u.practice.forEach(function (ex) {
      if (ex.type === "reading") {
        h += readingBlock(lang, ex);
        ex.questions.forEach(function (q) { h += renderCard("practice", lang, u.id, q.id); });
      } else {
        h += renderCard("practice", lang, u.id, ex.id);
      }
    });
    h += '<div class="btn-row"><a class="btn primary" href="#/' + lang + "/" + u.id + '/test">Go to the unit test <span aria-hidden="true">→</span></a>' +
      '<button class="btn ghost" data-action="clear-practice" data-unit="' + u.id + '">Clear my practice answers</button></div>';
    return h + "</div>";
  }

  function tabTest(lang, u) {
    var c = DATA[lang], d = S.langs[lang].drafts[u.id], us = peekU(lang, u.id);
    var attempts = us ? us.attempts : [];
    var h = '<div class="stack">';
    var rule = c.progression === "score"
      ? "Pass mark: " + c.passMark + "%. Written answers are self-marked (correct = 1, partly = ½, wrong = 0)."
      : "Any score unlocks the next unit. Written answers are self-marked (correct = 1, partly = ½, wrong = 0).";
    if (!d) {
      if (attempts.length) {
        var last = attempts[attempts.length - 1], best = bestScore(lang, u.id);
        var passed = c.progression === "score" ? best >= c.passMark : true;
        h += '<section class="card"><div class="score-big">' + last.score + '%</div><div class="muted">Last attempt, ' + esc(shortDate(last.date)) +
          " · best " + best + "%</div>";
        if (c.progression === "score") {
          h += passed
            ? '<div class="note good">Unit complete. ' + (unitIndex(lang, u.id) + 1 < units(lang).length ? "The next unit is unlocked." : "That was the last unit!") + "</div>"
            : '<div class="note bad">Below ' + c.passMark + "%. Go over the items you missed (they are in Review from tomorrow), then retake the test.</div>";
        } else {
          h += '<div class="note good">Test attempted. ' + (unitIndex(lang, u.id) + 1 < units(lang).length ? "The next unit is unlocked." : "That was the last unit!") + "</div>";
        }
        h += '<ul class="attempts">' + attempts.slice().reverse().map(function (a) {
          return "<li>" + esc(shortDate(a.date)) + " – " + a.score + "%</li>";
        }).join("") + "</ul>";
        h += '<div class="btn-row"><button class="btn primary" data-action="start-test" data-unit="' + u.id + '">' + (passed ? "Retake test" : "Retake test") + "</button></div></section>";
        if (last.items) {
          h += "<h2>Last attempt</h2>";
          flatTest(u).forEach(function (q) {
            var it = last.items[q.id] || {};
            var cls = it.result === "correct" ? "correct" : it.result === "partly" ? "lenient" : "wrong";
            h += '<div class="card"><div class="ex-head"><span class="tag">' + esc(TYPE_LABEL[q.type]) + '</span><span class="badge-last ' + (it.result || "wrong") + '">' + esc(it.result || "wrong") + "</span></div>" +
              '<div class="prompt">' + esc(q.prompt) + "</div>" +
              '<div class="compare"><div><h4>Your answer</h4><div class="txt">' + (it.answer ? esc(it.answer) : '<span class="muted">(empty)</span>') + "</div></div>" +
              '<div><h4>Model answer</h4><div class="txt">' + esc(q.answer) + "</div></div></div>" +
              '<div class="btn-row"><button class="btn small quiet" data-action="ask-attempt" data-lang="' + lang + '" data-unit="' + u.id + '" data-id="' + q.id + '">Ask Claude to correct</button></div></div>';
          });
        }
      } else {
        h += '<section class="card"><h2>Unit test</h2><p>' + flatTest(u).length + " written questions on this unit. " + esc(rule) + "</p>" +
          (lang === "de" ? '<p class="small muted">If you leave before submitting, the test waits for you in the Unfinished tab.</p>' : "") +
          '<div class="btn-row"><button class="btn primary" data-action="start-test" data-unit="' + u.id + '">Start test</button></div></section>';
      }
      return h + "</div>";
    }
    if (!d.submitted) {
      h += '<div class="note info">Started ' + esc(shortDate(d.startedAt)) + ". Your answers save automatically" + (lang === "de" ? " – if you stop now, this test stays in the Unfinished tab." : ".") + "</div>";
      flatTest(u).forEach(function (q) { h += renderCard("test", lang, u.id, q.id); });
      h += '<div class="btn-row"><button class="btn primary" data-action="submit-test" data-unit="' + u.id + '">Submit test</button></div>';
      return h + "</div>";
    }
    // submitted, needs marking
    var pending = flatTest(u).filter(function (q) { return !(d.marks[q.id] && d.marks[q.id].result); }).length;
    h += '<div class="note warn">Submitted. Mark each written answer against the model answer' + (pending ? " (" + pending + " left)" : "") + ", then finish to get your score.</div>";
    flatTest(u).forEach(function (q) { h += renderCard("test", lang, u.id, q.id); });
    h += '<div class="btn-row"><button class="btn primary" data-action="finish-test" data-unit="' + u.id + '"' + (pending ? " disabled" : "") + ">Finish and see score</button></div>";
    return h + "</div>";
  }

  function tabReview(lang, u) {
    var uid = reviewFilter === "unit" ? u.id : null;
    var keys = dueItems(lang, uid);
    var allDue = dueItems(lang).length;
    var h = '<div class="chips" role="group" aria-label="Filter">' +
      '<button class="chip" data-action="review-filter" data-value="unit" aria-pressed="' + (reviewFilter === "unit") + '">This unit (' + dueItems(lang, u.id).length + ")</button>" +
      '<button class="chip" data-action="review-filter" data-value="all" aria-pressed="' + (reviewFilter === "all") + '">All ' + esc(DATA[lang].language) + " units (" + allDue + ")</button></div>";
    if (!keys.length) {
      var up = upcomingCount(lang, uid);
      return h + '<div class="card empty">Nothing to review ' + (uid ? "in this unit " : "") + "today." + (up ? "<br>" + up + " item" + (up === 1 ? "" : "s") + " scheduled for later." : "") + "</div>";
    }
    h += '<p class="small muted">These are answers you marked wrong or partly right. Get one right and it comes back after 3 days, then 7 days, then it is cleared. Get it wrong again and it returns tomorrow.</p><div class="stack">';
    keys.forEach(function (k) {
      var r = S.review[k];
      var card = renderCard("review", r.lang, r.unit, r.item, { showUnit: true, showPassage: true });
      h += card.replace('class="card ex"', 'class="card ex" data-show-unit');
    });
    return h + "</div>";
  }

  function tabUnfinished(lang) {
    var ds = S.langs[lang].drafts;
    var keys = Object.keys(ds).sort(function (a, b) { return ds[a].startedAt < ds[b].startedAt ? -1 : 1; });
    if (!keys.length) return '<div class="card empty">No unfinished tests. Any German test you start but do not submit will wait here.</div>';
    var h = '<div class="stack">';
    keys.forEach(function (uid) {
      var d = ds[uid], u = getUnit(lang, uid);
      if (!u) return;
      var answered = flatTest(u).filter(function (q) { return (d.answers[q.id] || "").trim(); }).length;
      h += '<section class="card"><h3>Unit ' + (unitIndex(lang, uid) + 1) + ": " + esc(u.title) + "</h3>" +
        '<p class="small muted">Started ' + esc(shortDate(d.startedAt)) + " · " + answered + "/" + flatTest(u).length + " answered · " +
        (d.submitted ? "submitted, waiting for your self-marking" : "not submitted yet") + "</p>" +
        '<div class="btn-row"><a class="btn primary" href="#/' + lang + "/" + uid + '/test">' + (d.submitted ? "Finish marking" : "Resume test") + "</a></div></section>";
    });
    return h + "</div>";
  }

  // ------------------------------------------------------------------ routing
  function parseRoute() {
    var raw = location.hash.replace(/^#\/?/, "");
    var q = "";
    if (raw.indexOf("?") >= 0) { q = raw.slice(raw.indexOf("?") + 1); raw = raw.slice(0, raw.indexOf("?")); }
    var parts = raw.split("/").filter(Boolean);
    return { parts: parts, query: q };
  }
  var lastRoute = "";
  function render() {
    if (!DATA.de || !DATA.it) return; // course files still loading
    var r = parseRoute(), p = r.parts, html;
    var routeKey = p.join("/") + "?" + r.query;
    var newPage = routeKey !== lastRoute;
    if (newPage) { reviewSession = {}; snaps = {}; reviewFilter = r.query === "all" ? "all" : "unit"; }
    lastRoute = routeKey;
    if (!p.length || p[0] === "today") html = viewToday();
    else if (LANGS[p[0]] && p.length === 1) html = viewPath(p[0]);
    else if (LANGS[p[0]]) html = viewUnit(p[0], p[1], p[2] || "study");
    else html = viewToday();
    $("#app").innerHTML = html;
    if (newPage) window.scrollTo(0, 0);
    refreshVoices();
  }
  function rerenderKeepScroll() {
    var y = window.scrollY;
    render();
    window.scrollTo(0, y);
  }

  // ------------------------------------------------------------------ actions
  function cardInfo(el) {
    var card = el.closest("[data-card]");
    if (!card) return null;
    var p = card.getAttribute("data-card").split("|");
    var input = card.querySelector("[data-field=answer]");
    return { card: card, mode: p[0], lang: p[1], uid: p[2], id: p[3], answer: input ? input.value : "" };
  }

  function applyResult(ci, result, how) {
    if (ci.mode === "practice") {
      var pr = uState(ci.lang, ci.uid).practice;
      pr[ci.id] = { answer: ci.answer, result: result, how: how, at: today(), revealed: true };
      applyVerdict("practice", ci.lang, ci.uid, ci.id, result);
    } else if (ci.mode === "review") {
      var k = rKey(ci.lang, ci.uid, ci.id);
      reviewSession[k] = { answer: ci.answer, result: result, how: how, revealed: true };
      var res = applyVerdict("review", ci.lang, ci.uid, ci.id, result);
      if (result === "correct") toast(res === "mastered" ? "Cleared from review – well done!" : res ? "Next review: " + shortDate(res) : "Marked correct.");
      else toast("This one comes back tomorrow.");
    } else if (ci.mode === "test") {
      var d = S.langs[ci.lang].drafts[ci.uid];
      if (!d) return;
      d.marks[ci.id] = { result: result, how: how };
    }
    save();
  }

  function onCheck(ci) {
    var item = getItem(ci.lang, ci.uid, ci.id).item;
    if (item.check === "self") { // reveal the model answer; the learner marks it next
      var store = ci.mode === "practice" ? uState(ci.lang, ci.uid).practice : reviewSession;
      var key = ci.mode === "practice" ? ci.id : rKey(ci.lang, ci.uid, ci.id);
      store[key] = store[key] || {};
      store[key].answer = ci.answer;
      store[key].revealed = true;
      save();
      rerenderCard(ci.card);
      return;
    }
    if (!ci.answer.trim()) { toast("Type an answer first."); return; }
    var how = checkAnswer(ci.answer, item);
    applyResult(ci, how === "wrong" ? "wrong" : "correct", how);
    rerenderCard(ci.card);
  }

  function onMark(ci, value) {
    applyResult(ci, value, "self");
    if (ci.mode === "test") { rerenderKeepScroll(); return; }
    rerenderCard(ci.card);
  }

  function onOverride(ci) {
    applyResult(ci, "correct", "override");
    if (ci.mode === "test") { rerenderKeepScroll(); return; }
    rerenderCard(ci.card);
  }

  function startTest(lang, uid) {
    S.langs[lang].drafts[uid] = { startedAt: today(), answers: {}, marks: {}, submitted: false };
    save();
    rerenderKeepScroll();
  }

  function submitTest(lang, uid) {
    var d = S.langs[lang].drafts[uid], u = getUnit(lang, uid);
    var empty = flatTest(u).filter(function (q) { return !(d.answers[q.id] || "").trim(); }).length;
    if (empty && !window.confirm(empty + " question" + (empty === 1 ? " is" : "s are") + " still empty. Submit anyway?")) return;
    d.submitted = true;
    d.marks = {};
    flatTest(u).forEach(function (q) {
      if (q.check === "auto") {
        var how = checkAnswer(d.answers[q.id] || "", q);
        d.marks[q.id] = { result: how === "wrong" ? "wrong" : "correct", how: how };
      } else if (!(d.answers[q.id] || "").trim()) {
        d.marks[q.id] = { result: "wrong", how: "self" };
      }
    });
    save();
    render();
    window.scrollTo(0, 0);
  }

  function finishTest(lang, uid) {
    var d = S.langs[lang].drafts[uid], u = getUnit(lang, uid);
    var pts = { correct: 1, partly: 0.5, wrong: 0 }, total = 0, items = {};
    var qs = flatTest(u);
    for (var i = 0; i < qs.length; i++) {
      var m = d.marks[qs[i].id];
      if (!m || !m.result) { toast("Mark every answer first."); return; }
      total += pts[m.result];
      items[qs[i].id] = { answer: d.answers[qs[i].id] || "", result: m.result };
      if (m.result !== "correct") scheduleWrong(lang, uid, qs[i].id);
    }
    var score = Math.round(total / qs.length * 100);
    var wasDone = isDone(lang, uid);
    uState(lang, uid).attempts.push({ date: today(), score: score, items: items });
    delete S.langs[lang].drafts[uid];
    save();
    var c = DATA[lang];
    if (c.progression === "score") {
      if (score >= c.passMark) toast(wasDone ? "Score: " + score + "%." : "Score: " + score + "%. Unit complete – next unit unlocked!");
      else toast("Score: " + score + "%. You need " + c.passMark + "% – try again after reviewing.");
    } else {
      toast("Score: " + score + "%." + (wasDone ? "" : " Next unit unlocked."));
    }
    render();
    window.scrollTo(0, 0);
  }

  function exportState() {
    var payload = { app: "langstudy", exportedAt: new Date().toISOString(), state: S };
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "langstudy-backup-" + today() + ".json";
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    toast("Progress exported.");
  }

  function importState(file) {
    var reader = new FileReader();
    reader.onload = function () {
      var parsed;
      try { parsed = JSON.parse(reader.result); } catch (e) { toast("That file is not valid JSON."); return; }
      var st = parsed && parsed.state ? parsed.state : parsed;
      if (!st || typeof st !== "object" || !st.langs || !st.langs.de || !st.langs.it) { toast("That file is not a LangStudy backup."); return; }
      if (!window.confirm("Replace the progress in this browser with the backup? This cannot be undone (export first if unsure).")) return;
      S = normalizeState(st);
      save();
      applyTheme();
      render();
      toast("Progress imported.");
    };
    reader.readAsText(file);
  }

  function applyTheme() {
    if (S.theme === "auto") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = S.theme;
    document.querySelectorAll('[data-action="theme"]').forEach(function (b) {
      b.setAttribute("aria-pressed", String(b.getAttribute("data-value") === S.theme));
    });
    var meta = document.querySelectorAll('meta[name="theme-color"]');
    var dark = S.theme === "dark" || (S.theme === "auto" && window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
    meta.forEach(function (m) { m.setAttribute("content", dark ? "#191816" : "#faf7f0"); });
    var len = $("#opt-lenient");
    if (len) len.checked = !!S.lenient;
  }

  document.addEventListener("click", function (ev) {
    var el = ev.target.closest("[data-action]");
    if (!el) return;
    var a = el.getAttribute("data-action");
    var ci;
    switch (a) {
      case "speak": speak(el.getAttribute("data-text"), el.getAttribute("data-lang")); break;
      case "check": ci = cardInfo(el); if (ci) onCheck(ci); break;
      case "mark": ci = cardInfo(el); if (ci) onMark(ci, el.getAttribute("data-value")); break;
      case "override": ci = cardInfo(el); if (ci) onOverride(ci); break;
      case "ask":
        ci = cardInfo(el);
        if (ci) copyText(claudePrompt(ci.lang, ci.uid, ci.id, ci.answer)).then(function (ok) {
          toast(ok ? "Prompt copied – paste it into Claude." : "Couldn't copy automatically. Your browser blocked the clipboard.");
        });
        break;
      case "ask-attempt": {
        var lang = el.getAttribute("data-lang"), uid = el.getAttribute("data-unit"), id = el.getAttribute("data-id");
        var at = uState(lang, uid).attempts, last = at[at.length - 1];
        var ans = last && last.items && last.items[id] ? last.items[id].answer : "";
        copyText(claudePrompt(lang, uid, id, ans)).then(function (ok) { toast(ok ? "Prompt copied – paste it into Claude." : "Couldn't copy automatically."); });
        break;
      }
      case "start-test": startTest(parseRoute().parts[0], el.getAttribute("data-unit")); break;
      case "submit-test": submitTest(parseRoute().parts[0], el.getAttribute("data-unit")); break;
      case "finish-test": finishTest(parseRoute().parts[0], el.getAttribute("data-unit")); break;
      case "clear-practice": {
        var l = parseRoute().parts[0], u = el.getAttribute("data-unit");
        if (window.confirm("Clear your practice answers for this unit so you can do it again? Review items and test scores are kept.")) {
          uState(l, u).practice = {};
          save();
          render();
        }
        break;
      }
      case "review-filter": reviewFilter = el.getAttribute("data-value"); rerenderKeepScroll(); break;
      case "locked": toast("Locked – finish the current unit first."); break;
      case "theme": S.theme = el.getAttribute("data-value"); save(); applyTheme(); break;
      case "export": exportState(); break;
      case "import": $("#import-file").click(); break;
      case "reset":
        if (window.confirm("Delete ALL progress in this browser? Export a backup first if you might want it back.") &&
            window.confirm("Really delete everything?")) {
          S = defaultState(); save(); applyTheme(); render(); toast("Progress reset.");
        }
        break;
    }
  });

  document.addEventListener("change", function (ev) {
    if (ev.target.id === "opt-lenient") { S.lenient = ev.target.checked; save(); }
    if (ev.target.id === "import-file" && ev.target.files && ev.target.files[0]) {
      importState(ev.target.files[0]);
      ev.target.value = "";
      $("#menu").open = false;
    }
  });

  document.addEventListener("input", function (ev) {
    var t = ev.target;
    if (t.getAttribute("data-field") !== "answer") return;
    var ci = cardInfo(t);
    if (!ci) return;
    if (ci.mode === "practice") {
      var pr = uState(ci.lang, ci.uid).practice;
      pr[ci.id] = pr[ci.id] || {};
      pr[ci.id].answer = t.value;
      saveSoon();
    } else if (ci.mode === "test") {
      var d = S.langs[ci.lang].drafts[ci.uid];
      if (d && !d.submitted) { d.answers[ci.id] = t.value; saveSoon(); }
    } else if (ci.mode === "review") {
      var k = rKey(ci.lang, ci.uid, ci.id);
      reviewSession[k] = reviewSession[k] || {};
      reviewSession[k].answer = t.value;
    }
  });

  document.addEventListener("keydown", function (ev) {
    // Enter in a short-answer box checks it.
    if (ev.key === "Enter" && ev.target.matches && ev.target.matches("input.answer-input")) {
      var ci = cardInfo(ev.target);
      if (ci && ci.mode !== "test") { ev.preventDefault(); onCheck(ci); }
    }
  });

  // close the menu when clicking elsewhere
  document.addEventListener("click", function (ev) {
    var m = $("#menu");
    if (m && m.open && !m.contains(ev.target)) m.open = false;
  });

  window.addEventListener("hashchange", render);
  window.addEventListener("beforeunload", flush);
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "hidden") flush(); });
  // Another tab changed the progress: pick it up so this tab doesn't overwrite it later.
  window.addEventListener("storage", function (ev) {
    if (ev.key !== STORAGE_KEY) return;
    load();
    applyTheme();
    rerenderKeepScroll();
  });

  // ------------------------------------------------------------------ boot
  function boot() {
    load();
    applyTheme();
    Promise.all(Object.keys(LANGS).map(function (l) {
      return fetch(LANGS[l].file, { cache: "no-cache" }).then(function (r) {
        if (!r.ok) throw new Error(LANGS[l].file + ": HTTP " + r.status);
        return r.json();
      }).then(function (j) { DATA[l] = j; });
    })).then(function () {
      if (TTS.supported) {
        refreshVoices();
        window.speechSynthesis.onvoiceschanged = refreshVoices;
      }
      render();
    }).catch(function (err) {
      $("#app").innerHTML = '<div class="card"><h2>Could not load the course files</h2><p>' + esc(err.message) +
        "</p><p class=\"small muted\">If you opened index.html directly from your disk, browsers block loading the JSON files. Use the GitHub Pages link, or run a local server (see README).</p></div>";
    });
  }

  // Expose a tiny API for tests and debugging.
  window.LangStudy = {
    state: function () { return S; },
    data: function () { return DATA; },
    checkAnswer: function (u, item) { return checkAnswer(u, item); },
    status: function (l, uid) { return status(l, uid); },
    currentIndex: function (l) { return currentIndex(l); },
    claudePrompt: claudePrompt
  };

  boot();
})();
