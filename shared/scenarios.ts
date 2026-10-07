// Scenario bank. Scenarios 1-3 are extracted verbatim from reference/artifact-original.html (SCEN);
// 4-6 are the fun set (The fridge note, Treaty with the campus squirrel, McNutt plate strategy), chosen by Caio.
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
    "title": "The fridge note",
    "situation": "Someone keeps eating the leftovers you labeled in the dorm fridge. You hid the lasagna behind the pickles and it still vanished. You have the sticky note you wrote last week, which was ignored.",
    "goal": "Get the AI to write a note for the fridge that is firm but funny, under 40 words, without blaming anyone by name.",
    "notes": "Strong prompt: explains the situation (labeled leftovers keep disappearing from a shared dorm fridge, even the lasagna hidden behind the pickles), pastes the ignored sticky note as an example of what did not work, asks for one note under 40 words, sets a firm but funny tone, adds rules such as no names or accusations and nothing mean or passive-aggressive, and may ask for two or three options to pick from or invite questions first.",
    "must": [
      "note|sign|sticky",
      "fridge|refrigerator|leftover|lasagna|food",
      "\\d+ words|short|brief|under|concise",
      "funny|humor|humorous|joke|firm|playful|tone",
      "name|blam|accus|anyone|passive",
      "dorm|roommate|shared|floor|suite",
      "example|ignored|last week|didn't work|did not work|my (old|last|previous) note|sticky note"
    ]
  },
  {
    "id": 5,
    "position": 4,
    "title": "Treaty with the campus squirrel",
    "situation": "A squirrel outside the library steals half your sandwich every day. You have decided diplomacy is the only option. You found a real peace treaty online whose layout you want to imitate.",
    "goal": "Get the AI to draft a one-page peace treaty between you and the squirrel, with numbered clauses, a penalty for each violation, and a formal, deadpan tone.",
    "notes": "Strong prompt: sets the scene (a squirrel outside the library steals half the sandwich every day) and may cast the AI as a diplomat or treaty lawyer, attaches or pastes the real treaty whose layout to copy, asks for a one-page treaty with a title, preamble, numbered clauses, a penalty for each violation, and signature lines, sets a formal, deadpan tone, adds rules such as keep it to one page, never break character or wink at the joke, and keep it kind to the squirrel, and may invite questions first.",
    "must": [
      "treaty|agreement|accord|pact",
      "squirrel",
      "sandwich|food|lunch|library",
      "clause|article|numbered|section",
      "penalt|violation|consequence|breach",
      "formal|deadpan|serious|legal|official|tone",
      "one page|1 page|one-page|layout|format|example|attach|style of|real treaty"
    ]
  },
  {
    "id": 6,
    "position": 5,
    "title": "McNutt plate strategy",
    "situation": "You have one dining swipe left for the week, and you're walking into McNutt starving after a three-hour lab. You have a photo of the stations and a long history of bad decisions.",
    "goal": "Get the AI to act as a sports commentator who gives play-by-play of your plate strategy, under 150 words, ending with a verdict on whether the meal was a win or a loss.",
    "notes": "Strong prompt: casts the AI as a sports commentator, gives the context (one swipe left for the week, starving after a three-hour lab, walking into McNutt) and attaches the photo of the stations, asks for play-by-play of the plate strategy under 150 words that ends with a clear win-or-loss verdict, adds rules such as only use stations in the photo, keep it PG, and stay in character, and may name a commentator style to imitate (for example a hyped NFL announcer or a hushed golf broadcaster) or mention past bad decisions as material.",
    "must": [
      "commentator|announcer|broadcaster|sportscaster|play-by-play|play by play",
      "mcnutt|dining|swipe|plate|stations?",
      "lab|starving|hungry|three-hour|3-hour",
      "\\d+ words|under|short|brief",
      "verdict|win|loss",
      "photo|picture|attach|stations? in",
      "like a|style|espn|nfl|golf|example|tone"
    ]
  }
];
