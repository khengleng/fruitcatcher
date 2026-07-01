/* Lightweight bilingual (English / Khmer) UI layer for the learner-facing pages.
 * Usage:
 *   - Mark static text:  <h2 data-i18n="student.progress">My progress</h2>
 *   - Placeholders:      <input data-i18n-ph="common.username">
 *   - In JS:             I18N.t("engage.streak")
 *   - Toggle:            I18N.setLang("km")  (persisted; fires onChange callbacks)
 * Khmer strings are a first pass — recommend a native-speaker review.
 */
(function () {
  var LANG_KEY = "fruitcatcher_lang";
  var DICT = {
    en: {
      "lang.name": "English",
      "common.login": "Log in",
      "common.logout": "Log out",
      "common.createAccount": "Create account",
      "common.username": "Username",
      "common.password": "Password",
      "common.yourName": "Your name",
      "common.loading": "Loading…",
      "common.start": "Start",
      "common.retake": "Retake",
      "common.markDone": "Mark done",
      "common.remove": "Remove",
      "common.save": "Save",
      "common.signInPrompt": "Please sign in.",
      "student.title": "Student Portal",
      "student.subtitle": "Sign in to see the quizzes your teacher assigned.",
      "student.subtitleIn": "Tap a quiz to start. Your scores go to your teacher.",
      "student.joinClass": "Join a class with a code",
      "student.classCode": "Class code",
      "student.join": "Join",
      "student.tasks": "Tasks from your parent",
      "student.progress": "My progress",
      "student.mistakes": "Review your mistakes",
      "student.showMistakes": "Show my recent mistakes",
      "student.noMistakes": "No mistakes to review — great job! 🎉",
      "student.quizzes": "Your quizzes",
      "student.linkParent": "Link a parent",
      "student.linkParentHint": "Generate a code and share it with your parent so they can follow your progress and set you tasks. The code lasts 24 hours.",
      "student.generateCode": "Generate link code",
      "student.noTasks": "No tasks yet. Link a parent below and they can set you tasks.",
      "student.noProgress": "No progress yet — take a quiz to start growing your subject mastery. 🌱",
      "student.classCodeHint": "Class code (optional)",
      "parent.title": "Parent Portal",
      "parent.subtitle": "Follow your child's learning and set them tasks.",
      "parent.subtitleIn": "Link your child, review progress, and assign tasks.",
      "parent.linkChild": "Link a child",
      "parent.linkChildHint": "Ask your child to open their Student Portal → \"Link a parent\" → generate a code, then enter it here with their username.",
      "parent.childUsername": "Child's username",
      "parent.linkCode": "Link code",
      "parent.linkBtn": "Link child",
      "parent.children": "Your children",
      "parent.noChildren": "No children linked yet.",
      "parent.progressBySubject": "Progress by subject",
      "parent.assignTask": "Assign a task",
      "parent.assignedTasks": "Assigned tasks",
      "parent.type": "Type",
      "parent.practiceQuiz": "Practice quiz",
      "parent.todo": "To-do / goal",
      "parent.title2": "Title",
      "parent.note": "Note (optional)",
      "parent.subject": "Subject",
      "parent.grade": "Grade",
      "parent.curriculum": "Curriculum",
      "parent.language": "Language",
      "parent.questions": "Questions",
      "parent.due": "Due (optional)",
      "parent.assignBtn": "Assign task",
      "engage.streak": "day streak",
      "engage.level": "Level",
      "engage.todayGoal": "today's goal",
      "engage.goalDone": "goal done! ✅",
      "engage.thisWeek": "This week",
      "engage.questions": "questions",
      "engage.accuracy": "accuracy",
      "engage.activeDays": "active days",
      "practice.weakest": "Practise your weakest",
      "cert.button": "Certificate",
      "ctl.language": "Language",
      "ctl.curriculum": "Curriculum",
      "ctl.grade": "Grade",
      "ctl.subject": "Subject",
      "ctl.name": "NAME",
      "ctl.startQuiz": "Start Quiz",
      "ctl.next": "Next",
      "ctl.newQuiz": "New Quiz",
      "ctl.readAloud": "🔊 Read aloud",
      "ctl.stop": "⏹ Stop",
      "ctl.courseDetail": "Course detail",
      "ctl.stepByStep": "Step by step",
      "ctl.keyPoints": "Key points to remember",
      "ctl.creating": "Creating your next question",
      "ctl.creatingSub": "Our AI is preparing a fresh question just for you — this usually takes a few seconds. 🧠✨",
      "ctl.verifying": "Verifying your answer",
      "ctl.verifyingSub": "Checking your choice and preparing your explanation, video, and mini-lesson…",
      "ctl.stillWorking": "Still working on it",
      "ctl.patience": "Thanks for your patience — almost ready! 🌟",
      "ctl.hangTight": "Hang in there 🙏",
      "ctl.slowConn": "A slow connection can take a little longer. Your result is on the way!",
      "ctl.quizComplete": "Quiz complete. Your score:"
    },
    km: {
      "lang.name": "ខ្មែរ",
      "common.login": "ចូល",
      "common.logout": "ចេញ",
      "common.createAccount": "បង្កើតគណនី",
      "common.username": "ឈ្មោះអ្នកប្រើ",
      "common.password": "ពាក្យសម្ងាត់",
      "common.yourName": "ឈ្មោះរបស់អ្នក",
      "common.loading": "កំពុងផ្ទុក…",
      "common.start": "ចាប់ផ្តើម",
      "common.retake": "ធ្វើឡើងវិញ",
      "common.markDone": "សម្គាល់ថារួច",
      "common.remove": "លុប",
      "common.save": "រក្សាទុក",
      "common.signInPrompt": "សូមចូលគណនី។",
      "student.title": "វិបផតថលសិស្ស",
      "student.subtitle": "ចូលគណនីដើម្បីមើលកម្រងសំណួរដែលគ្រូបានផ្តល់។",
      "student.subtitleIn": "ចុចលើកម្រងសំណួរដើម្បីចាប់ផ្តើម។ ពិន្ទុរបស់អ្នកនឹងទៅដល់គ្រូ។",
      "student.joinClass": "ចូលរួមថ្នាក់ដោយប្រើកូដ",
      "student.classCode": "កូដថ្នាក់",
      "student.join": "ចូលរួម",
      "student.tasks": "កិច្ចការពីឪពុកម្តាយ",
      "student.progress": "វឌ្ឍនភាពរបស់ខ្ញុំ",
      "student.mistakes": "ពិនិត្យកំហុសរបស់អ្នក",
      "student.showMistakes": "បង្ហាញកំហុសថ្មីៗ",
      "student.noMistakes": "គ្មានកំហុសត្រូវពិនិត្យ — ល្អណាស់! 🎉",
      "student.quizzes": "កម្រងសំណួររបស់អ្នក",
      "student.linkParent": "ភ្ជាប់ឪពុកម្តាយ",
      "student.linkParentHint": "បង្កើតកូដ ហើយចែករំលែកទៅឪពុកម្តាយ ដើម្បីតាមដានវឌ្ឍនភាព និងផ្តល់កិច្ចការ។ កូដមានសុពលភាព ២៤ ម៉ោង។",
      "student.generateCode": "បង្កើតកូដភ្ជាប់",
      "student.noTasks": "មិនទាន់មានកិច្ចការទេ។ ភ្ជាប់ឪពុកម្តាយខាងក្រោម ដើម្បីទទួលកិច្ចការ។",
      "student.noProgress": "មិនទាន់មានវឌ្ឍនភាព — ធ្វើកម្រងសំណួរដើម្បីចាប់ផ្តើម។ 🌱",
      "student.classCodeHint": "កូដថ្នាក់ (ស្រេចចិត្ត)",
      "parent.title": "វិបផតថលឪពុកម្តាយ",
      "parent.subtitle": "តាមដានការសិក្សារបស់កូន និងផ្តល់កិច្ចការ។",
      "parent.subtitleIn": "ភ្ជាប់កូន ពិនិត្យវឌ្ឍនភាព និងផ្តល់កិច្ចការ។",
      "parent.linkChild": "ភ្ជាប់កូន",
      "parent.linkChildHint": "សុំឲ្យកូនបើកវិបផតថលសិស្ស → «ភ្ជាប់ឪពុកម្តាយ» → បង្កើតកូដ រួចបញ្ចូលកូដ និងឈ្មោះអ្នកប្រើនៅទីនេះ។",
      "parent.childUsername": "ឈ្មោះអ្នកប្រើរបស់កូន",
      "parent.linkCode": "កូដភ្ជាប់",
      "parent.linkBtn": "ភ្ជាប់កូន",
      "parent.children": "កូនរបស់អ្នក",
      "parent.noChildren": "មិនទាន់មានកូនភ្ជាប់ទេ។",
      "parent.progressBySubject": "វឌ្ឍនភាពតាមមុខវិជ្ជា",
      "parent.assignTask": "ផ្តល់កិច្ចការ",
      "parent.assignedTasks": "កិច្ចការដែលបានផ្តល់",
      "parent.type": "ប្រភេទ",
      "parent.practiceQuiz": "កម្រងសំណួរលំហាត់",
      "parent.todo": "កិច្ចការត្រូវធ្វើ",
      "parent.title2": "ចំណងជើង",
      "parent.note": "កំណត់ចំណាំ (ស្រេចចិត្ត)",
      "parent.subject": "មុខវិជ្ជា",
      "parent.grade": "ថ្នាក់",
      "parent.curriculum": "កម្មវិធីសិក្សា",
      "parent.language": "ភាសា",
      "parent.questions": "សំណួរ",
      "parent.due": "ថ្ងៃផុតកំណត់ (ស្រេចចិត្ត)",
      "parent.assignBtn": "ផ្តល់កិច្ចការ",
      "engage.streak": "ថ្ងៃជាប់គ្នា",
      "engage.level": "កម្រិត",
      "engage.todayGoal": "គោលដៅថ្ងៃនេះ",
      "engage.goalDone": "សម្រេចគោលដៅ! ✅",
      "engage.thisWeek": "សប្តាហ៍នេះ",
      "engage.questions": "សំណួរ",
      "engage.accuracy": "ភាពត្រឹមត្រូវ",
      "engage.activeDays": "ថ្ងៃសកម្ម",
      "practice.weakest": "ធ្វើលំហាត់មុខវិជ្ជាខ្សោយបំផុត",
      "cert.button": "វិញ្ញាបនបត្រ",
      "ctl.language": "ភាសា",
      "ctl.curriculum": "កម្មវិធីសិក្សា",
      "ctl.grade": "ថ្នាក់",
      "ctl.subject": "មុខវិជ្ជា",
      "ctl.name": "ឈ្មោះ",
      "ctl.startQuiz": "ចាប់ផ្តើម",
      "ctl.next": "បន្ទាប់",
      "ctl.newQuiz": "កម្រងសំណួរថ្មី",
      "ctl.readAloud": "🔊 អានឮៗ",
      "ctl.stop": "⏹ ឈប់",
      "ctl.courseDetail": "មេរៀនលម្អិត",
      "ctl.stepByStep": "មួយជំហានម្តងៗ",
      "ctl.keyPoints": "ចំណុចសំខាន់ត្រូវចងចាំ",
      "ctl.creating": "កំពុងបង្កើតសំណួរបន្ទាប់",
      "ctl.creatingSub": "បញ្ញាសិប្បនិមិត្តរបស់យើងកំពុងរៀបចំសំណួរថ្មីសម្រាប់អ្នក — ចំណាយពេលបន្តិច។ 🧠✨",
      "ctl.verifying": "កំពុងពិនិត្យចម្លើយ",
      "ctl.verifyingSub": "កំពុងពិនិត្យចម្លើយ និងរៀបចំការពន្យល់ វីដេអូ និងមេរៀន…",
      "ctl.stillWorking": "កំពុងដំណើរការ",
      "ctl.patience": "អរគុណសម្រាប់ការអត់ធ្មត់ — ជិតរួចហើយ! 🌟",
      "ctl.hangTight": "សូមរង់ចាំបន្តិច 🙏",
      "ctl.slowConn": "អ៊ីនធឺណិតយឺតអាចចំណាយពេលបន្តិច។ លទ្ធផលកំពុងមកដល់!",
      "ctl.quizComplete": "បញ្ចប់កម្រងសំណួរ។ ពិន្ទុរបស់អ្នក៖"
    }
  };

  var lang;
  try { lang = localStorage.getItem(LANG_KEY) || "en"; } catch (e) { lang = "en"; }
  if (lang !== "km") lang = "en";
  var callbacks = [];

  function t(key) {
    var table = DICT[lang] || DICT.en;
    if (table[key] != null) return table[key];
    if (DICT.en[key] != null) return DICT.en[key];
    return key;
  }

  function apply(root) {
    var scope = root || document;
    scope.querySelectorAll("[data-i18n]").forEach(function (el) {
      el.textContent = t(el.getAttribute("data-i18n"));
    });
    scope.querySelectorAll("[data-i18n-ph]").forEach(function (el) {
      el.setAttribute("placeholder", t(el.getAttribute("data-i18n-ph")));
    });
    try { document.documentElement.setAttribute("lang", lang); } catch (e) {}
  }

  function setLang(l) {
    lang = (l === "km") ? "km" : "en";
    try { localStorage.setItem(LANG_KEY, lang); } catch (e) {}
    apply(document);
    callbacks.forEach(function (cb) { try { cb(lang); } catch (e) {} });
  }

  window.I18N = {
    t: t,
    apply: apply,
    setLang: setLang,
    getLang: function () { return lang; },
    onChange: function (cb) { if (typeof cb === "function") callbacks.push(cb); }
  };

  if (document.readyState !== "loading") apply(document);
  else document.addEventListener("DOMContentLoaded", function () { apply(document); });
})();
