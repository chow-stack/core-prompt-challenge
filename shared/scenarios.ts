// Scenario bank. Scenarios 1-3 are extracted verbatim from reference/artifact-original.html (SCEN);
// 4-6 were replaced on 2026-10-07 with fun, non-school scenarios.
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
    "title": "Dorm-room chef",
    "situation": "It is 11 p.m., the dining hall is closed, and your mini fridge has eggs, shredded cheese, one tortilla, leftover rice, and hot sauce. You have a microwave and a mug. No stove.",
    "goal": "Get the AI to give you a late-night recipe you can actually make with only what you have, in under 10 minutes.",
    "notes": "Strong prompt: lists the exact ingredients and equipment (microwave and a mug, no stove), sets a time limit like under 10 minutes, asks for a short ingredient list and numbered steps with microwave times, says to use only what is listed and not to add anything else, sets a fun or casual tone, and may describe a flavor or format they like (for example spicy, like a breakfast burrito) or ask for one backup option, ending with an invitation to ask questions first.",
    "must": [
      "recipe|snack|meal|cook|make",
      "microwave|mug",
      "egg|cheese|tortilla|rice|hot sauce",
      "\\bonly\\b|don't add|do not add|nothing else|no stove|without",
      "\\d+ ?(min|minutes)|quick|fast|under",
      "step|numbered|list|instructions",
      "spicy|flavor|taste|like a|burrito|example"
    ]
  },
  {
    "id": 5,
    "position": 4,
    "title": "Spring break road trip",
    "situation": "You and three friends want a 4-day spring break road trip from Bloomington. You have one car, about $250 each, and nobody wants to drive more than 5 hours in a day.",
    "goal": "Get the AI to plan a fun day-by-day itinerary that fits the budget and the driving limit.",
    "notes": "Strong prompt: states the start city, group size, number of days, budget per person, and the 5-hour daily driving limit; says what the group likes (for example food, hiking, concerts, beaches); asks for a day-by-day table with drive time, stops, and estimated cost; adds rules such as stay under budget, no day over 5 hours of driving, and flag anything that needs a reservation; may give an example of a past trip they loved or a sample table row, and ends with an invitation to ask questions first.",
    "must": [
      "trip|itinerary|road|travel",
      "bloomington|indiana",
      "\\d+ ?(day|days)|four days|4-day|day by day|day-by-day",
      "budget|\\$|cost|cheap|afford",
      "\\d+ ?hours?|drive|driving",
      "table|schedule|plan|list",
      "friends|group|four of us|4 of us|people"
    ]
  },
  {
    "id": 6,
    "position": 5,
    "title": "Haunted campus adventure",
    "situation": "You have a free evening and want the AI to run a choose-your-own-adventure game for you, set on a spooky version of the IU campus on Halloween night.",
    "goal": "Get the AI to act as the game master and run an interactive story that stops and waits for your choice at every turn.",
    "notes": "Strong prompt: makes the AI the game master, sets the scene (haunted IU campus on Halloween night) and the player's character, asks for short scenes (for example under 120 words) that each end with 2 to 4 numbered choices, adds rules such as wait for my choice before continuing, keep it spooky but not gory, track an inventory or health, and wrap up within about 10 turns; may name a style to match (like Goosebumps or Stranger Things) or give a sample scene, and invites questions first.",
    "must": [
      "game master|narrator|dungeon master|\\bgm\\b|\\bdm\\b|run (a|the) game|act as|you are",
      "adventure|story|game",
      "spooky|halloween|haunted|ghost|campus|\\biu\\b|indiana",
      "choice|choose|option|\\d+ (choices|options)",
      "wait for|one (scene|turn) at a time|my (choice|answer|move)",
      "\\d+ ?(words|turns|sentences)|short|brief",
      "like|style|goosebumps|stranger things|example|tone"
    ]
  }
];
