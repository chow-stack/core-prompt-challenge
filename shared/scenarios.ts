// Scenario bank, extracted verbatim from reference/artifact-original.html (SCEN).
// `must` holds the RegExp sources (no flags; text is lowercased first).
// Server-only: grader notes and must patterns never ship to the browser.
// The database seed (supabase/migrations/*_seed_scenarios.sql) is generated from this file by scripts/gen-seed.mjs.

export type ScenarioSeed = {
  id: number;
  position: number;
  title: string;
  situation: string;
  goal: string;
  notes: string;
  must: string[];
};

export const SCENARIOS: ScenarioSeed[] = [
  {
    "id": 1,
    "position": 0,
    "title": "Exam study site",
    "situation": "Your Econ 201 midterm is Thursday and you are weakest on supply and demand. You have your lecture slides, handwritten notes, and a practice exam ready to attach.",
    "goal": "Get the AI to build an interactive study site made only from your own materials, with flashcards and a timed practice test.",
    "notes": "Strong prompt: gives a role such as tutor, the exam date and weak spot, and attaches slides, notes and practice exam; asks for an interactive site with a set number of flashcards and a timed practice test with a set number of questions; says to use only the attached materials; asks it to match the practice exam style and a design reference like Quizlet; ends with an invitation to ask questions first.",
    "must": [
      "\\b(site|website|app|interactive)\\b",
      "flashcard",
      "\\b(practice )?(test|exam|quiz)",
      "\\bonly\\b|\\battach|my (slides|notes|materials)",
      "supply|demand|weak|econ",
      "\\d"
    ]
  },
  {
    "id": 2,
    "position": 1,
    "title": "Mock interview",
    "situation": "You have a first-round marketing internship interview next week. You have the job posting in front of you and want to practice out loud.",
    "goal": "Get the AI to act as a tough recruiter, ask behavioral questions one at a time, and grade each answer with the STAR method.",
    "notes": "Strong prompt: sets the recruiter role and company, includes the job posting, asks for a set number of behavioral questions one at a time, says to grade each answer with STAR, sets a tough tone, adds rules such as wait for my answer before the next question, and may ask for a sample strong answer or end with an invitation to ask questions first.",
    "must": [
      "recruiter|interviewer|hiring",
      "behavioral|question",
      "one (question )?at a time|one by one|each",
      "\\bstar\\b|grade|score|feedback",
      "posting|job|internship|marketing",
      "tough|hard|strict|realistic|honest"
    ]
  },
  {
    "id": 3,
    "position": 2,
    "title": "Email to a professor",
    "situation": "You missed Tuesday’s lecture with a fever and need the slides. You have an email you once sent a professor that landed well.",
    "goal": "Get the AI to write a short, polite email asking for the slides, without over-apologizing.",
    "notes": "Strong prompt: states the situation (missed Tuesday with a fever), asks for an email asking for the slides, sets a word limit like under 100 words and a polite but not groveling tone, adds rules such as no over-apologizing, and pastes the liked email as an example to match.",
    "must": [
      "professor|prof\\b|instructor",
      "email",
      "missed|absent|fever|sick|tuesday",
      "slides|notes|lecture",
      "polite|respectful|professional|tone|friendly",
      "\\d+ words|short|brief|concise|under",
      "apolog|sorry|groveling|grovelling"
    ]
  },
  {
    "id": 4,
    "position": 3,
    "title": "Plan your month",
    "situation": "You have four syllabi and a work schedule, and every deadline blurs together. You can attach the syllabi and your weekly schedule.",
    "goal": "Get the AI to build one table of every deadline this month, sorted by date, and flag any week with two or more exams.",
    "notes": "Strong prompt: attaches syllabi and schedule, states the month and courses, asks for a table with named columns, sorted by date, with a rule to flag any week with two or more exams, says not to invent dates and to ask if a date is missing, and may show a sample row.",
    "must": [
      "table|spreadsheet|calendar|list",
      "deadline|due",
      "sort|order|by date|chronolog",
      "exam|midterm|test",
      "syllabus|syllabi|schedule",
      "flag|highlight|mark|two or more|2 or more|conflict|crunch",
      "month|october|week"
    ]
  },
  {
    "id": 5,
    "position": 4,
    "title": "Custom poster from a modified image",
    "situation": "You have a cartoon illustration you are allowed to use, such as your own artwork or one with a free license. You want a modified version to print as a dorm poster with Rasterbator.",
    "goal": "Get an image tool like Gemini to recreate the image in the same art style with only the changes you name, in a print-ready size.",
    "notes": "Strong prompt: attaches the image, says it is yours or free to use, asks for the exact same subject and art style, names the only changes (for example swap the color palette to maroon and cream and remove background clutter), says not to alter anything else, states a poster-friendly aspect ratio and high resolution, and may reference a style example.",
    "must": [
      "image|picture|photo|illustration|artwork",
      "poster|print|wall|rasterbator|large|resolution",
      "exact|same|keep|preserve|style",
      "color|colour|maroon|cream|background|remove|change|modif",
      "ratio|resolution|high|size|portrait|landscape|\\d",
      "\\bonly\\b|don't change|do not change|nothing else|leave"
    ]
  },
  {
    "id": 6,
    "position": 5,
    "title": "Class-notes podcast in NotebookLM",
    "situation": "Finals are close and your Intro to Psych notes cover six weeks. You would rather listen than reread. You can upload your notes and slides to NotebookLM.",
    "goal": "Get NotebookLM to turn your notes into a study podcast aimed at what you need to learn.",
    "notes": "Strong prompt: says the course and exam, that the notes and slides are uploaded as sources, asks for an audio overview with two hosts, a set length in minutes, a casual explain-it-simply tone, a focus on named weak topics, rules such as stick to the sources and define any jargon, and may name a style to imitate or end with an invitation to ask questions first.",
    "must": [
      "podcast|audio|overview|hosts?|conversation",
      "notes|slides|lecture|class|sources?",
      "\\d+ ?(min|minutes)|short|length|\\d",
      "casual|tone|friendly|explain|beginner|simple",
      "focus|weak|topics?|emphasi|prioriti",
      "\\bonly\\b|stick|don't|avoid|jargon|define",
      "exam|final|study|psych"
    ]
  }
];
