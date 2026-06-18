const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const { Pool } = require("pg");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = Number(process.env.PORT || 3000);
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const ADMIN_SESSION_TTL_MS = Number(process.env.ADMIN_SESSION_TTL_MS || 12 * 60 * 60 * 1000);
const ADMIN_ALLOWED_ORIGINS = (process.env.ADMIN_ALLOWED_ORIGINS || "https://admintv.cambobia.com,http://localhost:3002,http://127.0.0.1:3002")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const ADMIN_RATE_LIMIT_WINDOW_MS = Number(process.env.ADMIN_RATE_LIMIT_WINDOW_MS || 60 * 1000);
const ADMIN_RATE_LIMIT_MAX = Number(process.env.ADMIN_RATE_LIMIT_MAX || 120);
const ADMIN_LOGIN_RATE_LIMIT_MAX = Number(process.env.ADMIN_LOGIN_RATE_LIMIT_MAX || 10);
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5.4-mini";
const DATABASE_URL = process.env.DATABASE_URL || "";
const CONFIG_PATH = process.env.CONFIG_PATH || path.join(__dirname, "data", "game-config.json");
const APP_VERSION = process.env.APP_VERSION || "1.0.0";
const startedAt = new Date().toISOString();
const rooms = new Map();
const adminRateBuckets = new Map();
const db = DATABASE_URL
  ? new Pool({
      connectionString: DATABASE_URL,
      ssl: process.env.PGSSLMODE === "disable" || /localhost|127\.0\.0\.1/.test(DATABASE_URL)
        ? false
        : { rejectUnauthorized: false }
    })
  : null;
const SUPPORTED_SUBJECTS = [
  "math",
  "general_science",
  "biology",
  "chemistry",
  "physics",
  "english"
];
const SUPPORTED_CURRICULUMS = ["international", "cambodia_moeys"];
const SUPPORTED_LANGUAGES = ["english", "khmer", "bilingual"];
const SUPPORTED_DIFFICULTY_MODES = ["easy", "standard", "challenge"];
const SUPPORTED_QUESTION_SOURCES = [
  "question_bank_openai",
  "question_bank_only",
  "openai_only",
  "openai_fallback",
  "fallback_only"
];
const MIN_GRADE_LEVEL = 2;
const MAX_GRADE_LEVEL = 12;
const MAX_ROOM_PLAYERS = 40;

const defaultGameConfig = {
  brandTitle: process.env.BRAND_TITLE || "LyHuor Learning",
  brandCaption: process.env.BRAND_CAPTION || "Grades 2-12 Quiz Challenge",
  curriculum: process.env.CURRICULUM || "international",
  language: process.env.QUIZ_LANGUAGE || "english",
  subject: process.env.QUIZ_SUBJECT || "math",
  gradeLevel: Number(process.env.GRADE_LEVEL || 6),
  difficultyMode: process.env.DIFFICULTY_MODE || "standard",
  questionSource: process.env.QUESTION_SOURCE || "openai_fallback",
  questionsPerRound: Number(process.env.QUESTIONS_PER_ROUND || 10),
  questionTimerSec: Number(process.env.QUESTION_TIMER_SEC || 30)
};
const gameConfig = sanitizeConfig(loadPersistedConfig());

const FALLBACK_QUESTION_BANK = {
  math: {
    lower: [
      {
        question: "What is 7 + 5?",
        choices: [
          { id: "A", text: "10" },
          { id: "B", text: "11" },
          { id: "C", text: "12" },
          { id: "D", text: "13" }
        ],
        correctChoice: "C",
        shortExplanation: "Seven plus five equals twelve.",
        elaboration: "You can count on from 7: 8, 9, 10, 11, 12. That makes 12 the correct answer."
      },
      {
        question: "Which number is even?",
        choices: [
          { id: "A", text: "9" },
          { id: "B", text: "12" },
          { id: "C", text: "15" },
          { id: "D", text: "17" }
        ],
        correctChoice: "B",
        shortExplanation: "Even numbers can be split into two equal groups.",
        elaboration: "12 is even because it can be divided by 2 without anything left over. The others are odd numbers."
      },
      {
        question: "What is half of 18?",
        choices: [
          { id: "A", text: "7" },
          { id: "B", text: "8" },
          { id: "C", text: "9" },
          { id: "D", text: "10" }
        ],
        correctChoice: "C",
        shortExplanation: "Half means split into two equal parts.",
        elaboration: "If 18 is divided into 2 equal groups, each group has 9. So half of 18 is 9."
      }
    ],
    middle: [
      {
        question: "What is 3/4 written as a decimal?",
        choices: [
          { id: "A", text: "0.25" },
          { id: "B", text: "0.5" },
          { id: "C", text: "0.75" },
          { id: "D", text: "1.25" }
        ],
        correctChoice: "C",
        shortExplanation: "Three quarters equals seventy-five hundredths.",
        elaboration: "Divide 3 by 4 to get 0.75. You can also think of 3/4 as 75 out of 100."
      },
      {
        question: "What is the area of a rectangle with length 8 cm and width 5 cm?",
        choices: [
          { id: "A", text: "13 cm" },
          { id: "B", text: "26 cm2" },
          { id: "C", text: "40 cm2" },
          { id: "D", text: "80 cm2" }
        ],
        correctChoice: "C",
        shortExplanation: "Area of a rectangle is length times width.",
        elaboration: "Multiply 8 by 5 to find the area. 8 x 5 = 40, so the area is 40 square centimeters."
      },
      {
        question: "Solve: 6(x - 2) = 24",
        choices: [
          { id: "A", text: "x = 2" },
          { id: "B", text: "x = 4" },
          { id: "C", text: "x = 6" },
          { id: "D", text: "x = 10" }
        ],
        correctChoice: "C",
        shortExplanation: "First divide both sides by 6.",
        elaboration: "Dividing by 6 gives x - 2 = 4. Then add 2 to both sides, so x = 6."
      }
    ],
    upper: [
      {
        question: "What is the slope of the line passing through (2, 3) and (6, 11)?",
        choices: [
          { id: "A", text: "1" },
          { id: "B", text: "2" },
          { id: "C", text: "3" },
          { id: "D", text: "4" }
        ],
        correctChoice: "B",
        shortExplanation: "Slope is rise divided by run.",
        elaboration: "Subtract the y-values and x-values: (11 - 3) / (6 - 2) = 8 / 4 = 2. So the slope is 2."
      },
      {
        question: "What is the value of x in 2x^2 = 32 if x is positive?",
        choices: [
          { id: "A", text: "2" },
          { id: "B", text: "3" },
          { id: "C", text: "4" },
          { id: "D", text: "8" }
        ],
        correctChoice: "C",
        shortExplanation: "Divide by 2, then take the square root.",
        elaboration: "2x^2 = 32 becomes x^2 = 16. The positive square root of 16 is 4, so x = 4."
      },
      {
        question: "A triangle has side lengths 5, 12, and 13. What type of triangle is it?",
        choices: [
          { id: "A", text: "Right triangle" },
          { id: "B", text: "Equilateral triangle" },
          { id: "C", text: "Isosceles triangle" },
          { id: "D", text: "Obtuse triangle" }
        ],
        correctChoice: "A",
        shortExplanation: "5, 12, and 13 form a Pythagorean triple.",
        elaboration: "Because 5^2 + 12^2 = 25 + 144 = 169 and 13^2 = 169, the triangle is a right triangle."
      }
    ]
  },
  general_science: {
    lower: [
      {
        question: "Which part of a plant takes in water from the soil?",
        choices: [
          { id: "A", text: "Roots" },
          { id: "B", text: "Leaves" },
          { id: "C", text: "Flowers" },
          { id: "D", text: "Seeds" }
        ],
        correctChoice: "A",
        shortExplanation: "Roots absorb water and minerals.",
        elaboration: "The roots grow into the soil and take in water and nutrients that help the plant live and grow."
      },
      {
        question: "What do we call water that falls from clouds?",
        choices: [
          { id: "A", text: "Steam" },
          { id: "B", text: "Rain" },
          { id: "C", text: "Fog" },
          { id: "D", text: "Smoke" }
        ],
        correctChoice: "B",
        shortExplanation: "Rain is liquid water falling from clouds.",
        elaboration: "When water droplets in clouds grow heavy enough, they fall to the ground as rain."
      },
      {
        question: "Which object gives Earth light and heat?",
        choices: [
          { id: "A", text: "The Moon" },
          { id: "B", text: "Mars" },
          { id: "C", text: "The Sun" },
          { id: "D", text: "A star map" }
        ],
        correctChoice: "C",
        shortExplanation: "The Sun is Earth's main source of light and heat.",
        elaboration: "Earth gets energy from the Sun. That energy gives us daylight and helps keep our planet warm enough for life."
      }
    ],
    middle: [
      {
        question: "Which planet is known as the Red Planet?",
        choices: [
          { id: "A", text: "Mars" },
          { id: "B", text: "Venus" },
          { id: "C", text: "Jupiter" },
          { id: "D", text: "Mercury" }
        ],
        correctChoice: "A",
        shortExplanation: "Mars looks reddish because of iron-rich dust.",
        elaboration: "Mars is called the Red Planet because iron minerals in its soil rust and give the surface a reddish color."
      },
      {
        question: "What process allows plants to make their own food using sunlight?",
        choices: [
          { id: "A", text: "Respiration" },
          { id: "B", text: "Photosynthesis" },
          { id: "C", text: "Digestion" },
          { id: "D", text: "Evaporation" }
        ],
        correctChoice: "B",
        shortExplanation: "Plants use sunlight to make food by photosynthesis.",
        elaboration: "During photosynthesis, plants use sunlight, water, and carbon dioxide to produce glucose and oxygen."
      },
      {
        question: "What happens to the particles in a substance when temperature increases?",
        choices: [
          { id: "A", text: "They disappear" },
          { id: "B", text: "They move more slowly" },
          { id: "C", text: "They move faster" },
          { id: "D", text: "They stop moving" }
        ],
        correctChoice: "C",
        shortExplanation: "Heating gives particles more kinetic energy.",
        elaboration: "When a substance gets hotter, its particles gain energy and move faster. That is why many materials expand when heated."
      }
    ],
    upper: [
      {
        question: "Which organelle is called the powerhouse of the cell?",
        choices: [
          { id: "A", text: "Nucleus" },
          { id: "B", text: "Mitochondrion" },
          { id: "C", text: "Ribosome" },
          { id: "D", text: "Vacuole" }
        ],
        correctChoice: "B",
        shortExplanation: "Mitochondria release usable energy from food.",
        elaboration: "Mitochondria carry out cellular respiration, producing ATP that cells use as an energy source for many activities."
      },
      {
        question: "If an object's velocity changes, what must also change?",
        choices: [
          { id: "A", text: "Its mass" },
          { id: "B", text: "Its acceleration" },
          { id: "C", text: "Its color" },
          { id: "D", text: "Its volume" }
        ],
        correctChoice: "B",
        shortExplanation: "Acceleration is the rate of change of velocity.",
        elaboration: "Any change in speed or direction means the velocity changed. That means the object experienced acceleration."
      },
      {
        question: "What type of bond forms when atoms share electrons?",
        choices: [
          { id: "A", text: "Ionic bond" },
          { id: "B", text: "Metallic bond" },
          { id: "C", text: "Covalent bond" },
          { id: "D", text: "Hydrogen bond" }
        ],
        correctChoice: "C",
        shortExplanation: "Shared electrons make a covalent bond.",
        elaboration: "In a covalent bond, atoms share pairs of electrons. This helps each atom reach a more stable electron arrangement."
      }
    ]
  },
  biology: {
    lower: [
      {
        question: "Which part of the body helps you think?",
        choices: [
          { id: "A", text: "Brain" },
          { id: "B", text: "Hand" },
          { id: "C", text: "Knee" },
          { id: "D", text: "Foot" }
        ],
        correctChoice: "A",
        shortExplanation: "The brain controls thinking and body actions.",
        elaboration: "Your brain helps you think, remember, learn, and control many body functions."
      },
      {
        question: "Which part of a plant makes seeds?",
        choices: [
          { id: "A", text: "Root" },
          { id: "B", text: "Flower" },
          { id: "C", text: "Stem" },
          { id: "D", text: "Leaf" }
        ],
        correctChoice: "B",
        shortExplanation: "Flowers help plants reproduce.",
        elaboration: "Flowers are the part of many plants that help make seeds so new plants can grow."
      },
      {
        question: "What do animals need to live?",
        choices: [
          { id: "A", text: "Water" },
          { id: "B", text: "Plastic" },
          { id: "C", text: "Sand only" },
          { id: "D", text: "Metal" }
        ],
        correctChoice: "A",
        shortExplanation: "Animals need water to stay alive.",
        elaboration: "Living things need resources such as water, air, and food. Water is essential for survival."
      }
    ],
    middle: [
      {
        question: "Which organelle is called the powerhouse of the cell?",
        choices: [
          { id: "A", text: "Nucleus" },
          { id: "B", text: "Mitochondrion" },
          { id: "C", text: "Ribosome" },
          { id: "D", text: "Vacuole" }
        ],
        correctChoice: "B",
        shortExplanation: "Mitochondria release usable energy from food.",
        elaboration: "Mitochondria carry out cellular respiration, producing ATP that cells use as an energy source."
      },
      {
        question: "What process allows plants to make their own food using sunlight?",
        choices: [
          { id: "A", text: "Respiration" },
          { id: "B", text: "Photosynthesis" },
          { id: "C", text: "Digestion" },
          { id: "D", text: "Evaporation" }
        ],
        correctChoice: "B",
        shortExplanation: "Plants make food by photosynthesis.",
        elaboration: "During photosynthesis, plants use sunlight, water, and carbon dioxide to produce glucose and oxygen."
      },
      {
        question: "Which system in the human body carries blood?",
        choices: [
          { id: "A", text: "Digestive system" },
          { id: "B", text: "Circulatory system" },
          { id: "C", text: "Nervous system" },
          { id: "D", text: "Skeletal system" }
        ],
        correctChoice: "B",
        shortExplanation: "The circulatory system moves blood through the body.",
        elaboration: "The heart, blood, and blood vessels make up the circulatory system, which transports oxygen and nutrients."
      }
    ],
    upper: [
      {
        question: "What is the main function of DNA?",
        choices: [
          { id: "A", text: "To digest food" },
          { id: "B", text: "To store genetic information" },
          { id: "C", text: "To pump blood" },
          { id: "D", text: "To make bones hard" }
        ],
        correctChoice: "B",
        shortExplanation: "DNA stores hereditary instructions.",
        elaboration: "DNA contains genetic information that helps determine traits and directs how cells grow and function."
      },
      {
        question: "Which process produces gametes with half the usual number of chromosomes?",
        choices: [
          { id: "A", text: "Mitosis" },
          { id: "B", text: "Photosynthesis" },
          { id: "C", text: "Meiosis" },
          { id: "D", text: "Diffusion" }
        ],
        correctChoice: "C",
        shortExplanation: "Meiosis forms sex cells with half the chromosome number.",
        elaboration: "Meiosis reduces chromosome number by half, which is necessary for sexual reproduction."
      },
      {
        question: "Which level of organization comes after tissue in multicellular organisms?",
        choices: [
          { id: "A", text: "Atom" },
          { id: "B", text: "Cell" },
          { id: "C", text: "Organ" },
          { id: "D", text: "Molecule" }
        ],
        correctChoice: "C",
        shortExplanation: "Tissues combine to form organs.",
        elaboration: "The order is cell, tissue, organ, organ system, organism. So organ comes after tissue."
      }
    ]
  },
  chemistry: {
    lower: [
      {
        question: "What do we call water when it turns into ice?",
        choices: [
          { id: "A", text: "A gas" },
          { id: "B", text: "A solid" },
          { id: "C", text: "A fire" },
          { id: "D", text: "A metal" }
        ],
        correctChoice: "B",
        shortExplanation: "Ice is the solid form of water.",
        elaboration: "When water cools enough, it freezes and changes from a liquid into a solid called ice."
      },
      {
        question: "Which of these is a liquid at room temperature?",
        choices: [
          { id: "A", text: "Water" },
          { id: "B", text: "Stone" },
          { id: "C", text: "Air" },
          { id: "D", text: "Wood" }
        ],
        correctChoice: "A",
        shortExplanation: "Water is a liquid at room temperature.",
        elaboration: "A liquid can flow and take the shape of its container. Water behaves that way at room temperature."
      },
      {
        question: "What happens when sugar dissolves in water?",
        choices: [
          { id: "A", text: "It disappears completely" },
          { id: "B", text: "It becomes part of a mixture" },
          { id: "C", text: "It turns into a rock" },
          { id: "D", text: "It starts burning" }
        ],
        correctChoice: "B",
        shortExplanation: "Dissolving makes a solution, which is a type of mixture.",
        elaboration: "The sugar spreads through the water to form a solution, but the matter is still there."
      }
    ],
    middle: [
      {
        question: "What type of bond forms when atoms share electrons?",
        choices: [
          { id: "A", text: "Ionic bond" },
          { id: "B", text: "Metallic bond" },
          { id: "C", text: "Covalent bond" },
          { id: "D", text: "Hydrogen bond" }
        ],
        correctChoice: "C",
        shortExplanation: "Shared electrons make a covalent bond.",
        elaboration: "In a covalent bond, atoms share pairs of electrons to reach more stable outer energy levels."
      },
      {
        question: "Which particle in an atom has a negative charge?",
        choices: [
          { id: "A", text: "Proton" },
          { id: "B", text: "Electron" },
          { id: "C", text: "Neutron" },
          { id: "D", text: "Nucleus" }
        ],
        correctChoice: "B",
        shortExplanation: "Electrons carry negative charge.",
        elaboration: "Atoms contain protons with positive charge, neutrons with no charge, and electrons with negative charge."
      },
      {
        question: "What is the pH of a neutral solution?",
        choices: [
          { id: "A", text: "0" },
          { id: "B", text: "3" },
          { id: "C", text: "7" },
          { id: "D", text: "14" }
        ],
        correctChoice: "C",
        shortExplanation: "A neutral solution has pH 7.",
        elaboration: "On the pH scale, values below 7 are acidic, above 7 are basic, and 7 is neutral."
      }
    ],
    upper: [
      {
        question: "What does the atomic number of an element represent?",
        choices: [
          { id: "A", text: "Number of neutrons only" },
          { id: "B", text: "Number of protons" },
          { id: "C", text: "Total mass number" },
          { id: "D", text: "Number of shells" }
        ],
        correctChoice: "B",
        shortExplanation: "Atomic number equals the number of protons.",
        elaboration: "The atomic number identifies an element because each element has a unique number of protons."
      },
      {
        question: "Which change is a chemical change?",
        choices: [
          { id: "A", text: "Melting ice" },
          { id: "B", text: "Cutting paper" },
          { id: "C", text: "Rusting iron" },
          { id: "D", text: "Boiling water" }
        ],
        correctChoice: "C",
        shortExplanation: "Rusting creates a new substance.",
        elaboration: "Chemical changes form new substances. Rusting turns iron into iron oxide, unlike simple physical changes."
      },
      {
        question: "According to the kinetic molecular theory, why does gas pressure increase when temperature rises in a sealed container?",
        choices: [
          { id: "A", text: "Particles become heavier" },
          { id: "B", text: "Particles move faster and collide more forcefully" },
          { id: "C", text: "Particles stop moving" },
          { id: "D", text: "The container disappears" }
        ],
        correctChoice: "B",
        shortExplanation: "Hotter gas particles move faster and hit the walls harder.",
        elaboration: "Higher temperature increases the average kinetic energy of gas particles, raising the force and frequency of collisions."
      }
    ]
  },
  physics: {
    lower: [
      {
        question: "Which force pulls objects toward Earth?",
        choices: [
          { id: "A", text: "Sound" },
          { id: "B", text: "Gravity" },
          { id: "C", text: "Color" },
          { id: "D", text: "Shadow" }
        ],
        correctChoice: "B",
        shortExplanation: "Gravity pulls things downward.",
        elaboration: "Gravity is the force that attracts objects toward Earth, which is why dropped things fall down."
      },
      {
        question: "Which object can produce light?",
        choices: [
          { id: "A", text: "Lamp" },
          { id: "B", text: "Stone" },
          { id: "C", text: "Book" },
          { id: "D", text: "Pencil" }
        ],
        correctChoice: "A",
        shortExplanation: "A lamp is a source of light.",
        elaboration: "Some objects emit light, such as lamps or the Sun. Others only reflect light."
      },
      {
        question: "What helps a toy car move when you push it?",
        choices: [
          { id: "A", text: "A force" },
          { id: "B", text: "A smell" },
          { id: "C", text: "A color" },
          { id: "D", text: "A taste" }
        ],
        correctChoice: "A",
        shortExplanation: "A push is a force.",
        elaboration: "Motion can start when a force such as a push or pull acts on an object."
      }
    ],
    middle: [
      {
        question: "What happens to the particles in a substance when temperature increases?",
        choices: [
          { id: "A", text: "They disappear" },
          { id: "B", text: "They move more slowly" },
          { id: "C", text: "They move faster" },
          { id: "D", text: "They stop moving" }
        ],
        correctChoice: "C",
        shortExplanation: "Heating gives particles more kinetic energy.",
        elaboration: "When a substance gets hotter, its particles gain energy and move faster."
      },
      {
        question: "If an object's velocity changes, what must also change?",
        choices: [
          { id: "A", text: "Its mass" },
          { id: "B", text: "Its acceleration" },
          { id: "C", text: "Its color" },
          { id: "D", text: "Its volume" }
        ],
        correctChoice: "B",
        shortExplanation: "Acceleration is the rate of change of velocity.",
        elaboration: "Any change in speed or direction means the velocity changed, so the object experienced acceleration."
      },
      {
        question: "Which type of energy is stored in a stretched rubber band?",
        choices: [
          { id: "A", text: "Thermal energy" },
          { id: "B", text: "Elastic potential energy" },
          { id: "C", text: "Sound energy" },
          { id: "D", text: "Nuclear energy" }
        ],
        correctChoice: "B",
        shortExplanation: "Stretching stores elastic potential energy.",
        elaboration: "Elastic objects can store energy when stretched or compressed. That stored energy is elastic potential energy."
      }
    ],
    upper: [
      {
        question: "What is Newton's second law commonly written as?",
        choices: [
          { id: "A", text: "F = ma" },
          { id: "B", text: "E = mc^2" },
          { id: "C", text: "V = IR" },
          { id: "D", text: "p = mv" }
        ],
        correctChoice: "A",
        shortExplanation: "Force equals mass times acceleration.",
        elaboration: "Newton's second law states that the net force on an object equals its mass multiplied by its acceleration."
      },
      {
        question: "What happens to the wavelength of light as its frequency increases?",
        choices: [
          { id: "A", text: "It increases" },
          { id: "B", text: "It decreases" },
          { id: "C", text: "It stays the same" },
          { id: "D", text: "It becomes zero" }
        ],
        correctChoice: "B",
        shortExplanation: "Frequency and wavelength are inversely related for light.",
        elaboration: "Because the speed of light is constant in a vacuum, higher frequency means a shorter wavelength."
      },
      {
        question: "Which statement best describes conservation of energy?",
        choices: [
          { id: "A", text: "Energy can be created from nothing" },
          { id: "B", text: "Energy can be destroyed completely" },
          { id: "C", text: "Energy changes form but total energy is conserved" },
          { id: "D", text: "Energy exists only in moving objects" }
        ],
        correctChoice: "C",
        shortExplanation: "Energy can transfer or transform, but the total is conserved.",
        elaboration: "In a closed system, energy is not created or destroyed. It changes forms such as kinetic, thermal, or potential energy."
      }
    ]
  },
  english: {
    lower: [
      {
        question: "Which word is a noun?",
        choices: [
          { id: "A", text: "run" },
          { id: "B", text: "happy" },
          { id: "C", text: "school" },
          { id: "D", text: "quickly" }
        ],
        correctChoice: "C",
        shortExplanation: "A noun names a person, place, thing, or idea.",
        elaboration: "School is the name of a place, so it is a noun. The other words are different parts of speech."
      },
      {
        question: "Which sentence ends with a question mark?",
        choices: [
          { id: "A", text: "Please close the door." },
          { id: "B", text: "What time is lunch?" },
          { id: "C", text: "The dog is sleeping." },
          { id: "D", text: "I like blue shoes." }
        ],
        correctChoice: "B",
        shortExplanation: "A question asks something and ends with a question mark.",
        elaboration: "What time is lunch asks for information, so it is a question and should end with a question mark."
      },
      {
        question: "Which word is the opposite of 'cold'?",
        choices: [
          { id: "A", text: "warm" },
          { id: "B", text: "slow" },
          { id: "C", text: "dark" },
          { id: "D", text: "small" }
        ],
        correctChoice: "A",
        shortExplanation: "Warm is an antonym of cold.",
        elaboration: "Words with opposite meanings are antonyms. Warm means nearly the opposite of cold."
      }
    ],
    middle: [
      {
        question: "Which sentence uses the verb in the past tense?",
        choices: [
          { id: "A", text: "She walks to school." },
          { id: "B", text: "She walked to school." },
          { id: "C", text: "She is walking to school." },
          { id: "D", text: "She will walk to school." }
        ],
        correctChoice: "B",
        shortExplanation: "Walked shows an action that already happened.",
        elaboration: "Past tense verbs describe actions completed in the past. In this sentence, walked tells us the action happened earlier."
      },
      {
        question: "Which word is a synonym for 'rapid'?",
        choices: [
          { id: "A", text: "slow" },
          { id: "B", text: "careful" },
          { id: "C", text: "quick" },
          { id: "D", text: "heavy" }
        ],
        correctChoice: "C",
        shortExplanation: "A synonym has a similar meaning.",
        elaboration: "Rapid means fast. Quick also means fast, so quick is the best synonym."
      },
      {
        question: "Which sentence uses correct punctuation?",
        choices: [
          { id: "A", text: "After lunch we went outside" },
          { id: "B", text: "After lunch, we went outside." },
          { id: "C", text: "After lunch we, went outside." },
          { id: "D", text: "After lunch we went outside," }
        ],
        correctChoice: "B",
        shortExplanation: "The sentence needs both a comma and a period.",
        elaboration: "After lunch is an introductory phrase, so a comma fits after it. The complete sentence also ends with a period."
      }
    ],
    upper: [
      {
        question: "Which sentence uses the semicolon correctly?",
        choices: [
          { id: "A", text: "I studied hard; therefore, I felt prepared." },
          { id: "B", text: "Because I studied hard; I felt prepared." },
          { id: "C", text: "I; studied hard therefore I felt prepared." },
          { id: "D", text: "I studied; hard, therefore I felt prepared." }
        ],
        correctChoice: "A",
        shortExplanation: "A semicolon can join closely related independent clauses.",
        elaboration: "Option A correctly links two complete thoughts and uses therefore as a conjunctive adverb with a following comma."
      },
      {
        question: "What is the tone of a passage that uses words like 'gloomy,' 'dreary,' and 'hopeless'?",
        choices: [
          { id: "A", text: "Joyful" },
          { id: "B", text: "Formal" },
          { id: "C", text: "Optimistic" },
          { id: "D", text: "Melancholy" }
        ],
        correctChoice: "D",
        shortExplanation: "Those words create a sad, heavy feeling.",
        elaboration: "Tone is the author's attitude or emotional coloring. Gloomy, dreary, and hopeless suggest a melancholy tone."
      },
      {
        question: "Which sentence is in the passive voice?",
        choices: [
          { id: "A", text: "The committee approved the plan." },
          { id: "B", text: "The plan was approved by the committee." },
          { id: "C", text: "The committee is approving the plan." },
          { id: "D", text: "The committee will approve the plan." }
        ],
        correctChoice: "B",
        shortExplanation: "Passive voice puts the receiver of the action first.",
        elaboration: "In passive voice, the subject receives the action. The plan was approved by the committee follows that structure."
      }
    ]
  }
};

function getGradeBand(gradeLevel) {
  if (gradeLevel <= 4) {
    return "lower";
  }

  if (gradeLevel <= 8) {
    return "middle";
  }

  return "upper";
}

function getCurriculumLabel(curriculum) {
  if (curriculum === "cambodia_moeys") {
    return "Cambodia MoEYS";
  }

  return "International";
}

function getSubjectLabel(subject) {
  if (subject === "general_science") {
    return "General Science";
  }

  if (subject === "biology") {
    return "Biology";
  }

  if (subject === "chemistry") {
    return "Chemistry";
  }

  if (subject === "physics") {
    return "Physics";
  }

  if (subject === "math") {
    return "Math";
  }

  if (subject === "english") {
    return "English";
  }

  return subject;
}

function getLanguageLabel(language) {
  if (language === "khmer") {
    return "Khmer";
  }

  if (language === "bilingual") {
    return "Bilingual Khmer-English";
  }

  return "English";
}

function getDifficultyInstruction(difficultyMode) {
  if (difficultyMode === "easy") {
    return "Prefer a gentle difficulty level with simpler wording and more direct answers.";
  }

  if (difficultyMode === "challenge") {
    return "Prefer a more demanding version for the same grade, while staying age-appropriate and classroom-safe.";
  }

  return "Use standard classroom difficulty for the selected grade.";
}

function getLanguageInstruction(language) {
  if (language === "khmer") {
    return "Write all student-facing text in Khmer script.";
  }

  if (language === "bilingual") {
    return "Write all student-facing text bilingually with Khmer first and English second in the same field.";
  }

  return "Write all student-facing text in English.";
}

function getCurriculumInstruction(curriculum) {
  if (curriculum === "cambodia_moeys") {
    return "Align the content to Cambodia Ministry of Education classroom expectations and vocabulary for the selected grade. Do not mention policy names unless needed.";
  }

  return "Align the content to a general international-school curriculum. Keep it globally understandable and do not claim official Cambridge affiliation.";
}

function getFallbackQuestion(room) {
  const subject = SUPPORTED_SUBJECTS.includes(gameConfig.subject) ? gameConfig.subject : "math";
  const band = getGradeBand(gameConfig.gradeLevel);
  const bank = FALLBACK_QUESTION_BANK[subject][band];
  const template = bank[room.questionIndex % bank.length];

  return {
    ...template,
    subject
  };
}

function normalizePrompt(text) {
  return String(text || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function loadPersistedConfig() {
  try {
    if (!fs.existsSync(CONFIG_PATH)) {
      return defaultGameConfig;
    }

    const raw = fs.readFileSync(CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return {
      ...defaultGameConfig,
      ...parsed
    };
  } catch (error) {
    console.error("Failed to load persisted config:", error);
    return defaultGameConfig;
  }
}

function persistConfig(nextConfig) {
  try {
    const directory = path.dirname(CONFIG_PATH);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(nextConfig, null, 2));
    return true;
  } catch (error) {
    console.error("Failed to persist config:", error);
    return false;
  }
}

function createId() {
  return crypto.randomUUID();
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(String(password), salt, 64).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
  const [, salt, hash] = String(storedHash || "").split(":");
  if (!salt || !hash) {
    return false;
  }

  const candidate = hashPassword(password, salt).split(":")[2];
  if (candidate.length !== hash.length) {
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(candidate, "hex"), Buffer.from(hash, "hex"));
}

function signAdminSession(user) {
  const payload = Buffer.from(JSON.stringify({
    sub: user.id,
    username: user.username,
    role: user.role || "admin",
    exp: Date.now() + ADMIN_SESSION_TTL_MS
  })).toString("base64url");
  const signature = crypto
    .createHmac("sha256", ADMIN_TOKEN || APP_VERSION)
    .update(payload)
    .digest("base64url");
  return `${payload}.${signature}`;
}

function verifyAdminSession(token) {
  const [payload, signature] = String(token || "").split(".");
  if (!payload || !signature || !ADMIN_TOKEN) {
    return null;
  }

  const expected = crypto
    .createHmac("sha256", ADMIN_TOKEN)
    .update(payload)
    .digest("base64url");
  if (signature.length !== expected.length) {
    return null;
  }
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    return null;
  }

  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return session.exp > Date.now() ? session : null;
  } catch (error) {
    return null;
  }
}

function makeHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function requireValid(condition, message) {
  if (!condition) {
    throw makeHttpError(400, message);
  }
}

function rateLimitAdmin(req, res, next) {
  if (!req.path.startsWith("/admin")) {
    next();
    return;
  }

  const key = `${req.ip || req.socket?.remoteAddress || "unknown"}:${req.path === "/admin/login" ? "login" : "admin"}`;
  const now = Date.now();
  const max = req.path === "/admin/login" ? ADMIN_LOGIN_RATE_LIMIT_MAX : ADMIN_RATE_LIMIT_MAX;
  const bucket = adminRateBuckets.get(key) || { count: 0, resetAt: now + ADMIN_RATE_LIMIT_WINDOW_MS };

  if (now > bucket.resetAt) {
    bucket.count = 0;
    bucket.resetAt = now + ADMIN_RATE_LIMIT_WINDOW_MS;
  }

  bucket.count += 1;
  adminRateBuckets.set(key, bucket);
  res.setHeader("X-RateLimit-Limit", String(max));
  res.setHeader("X-RateLimit-Remaining", String(Math.max(0, max - bucket.count)));
  res.setHeader("X-RateLimit-Reset", String(Math.ceil(bucket.resetAt / 1000)));

  if (bucket.count > max) {
    res.status(429).json({ error: "Too many admin requests. Please wait and try again." });
    return;
  }

  next();
}

async function dbQuery(text, params = []) {
  if (!db) {
    return null;
  }

  try {
    return await db.query(text, params);
  } catch (error) {
    console.error("Database query failed:", error);
    return null;
  }
}

async function dbQueryRequired(text, params = []) {
  if (!db) {
    throw new Error("Postgres is not configured");
  }

  return db.query(text, params);
}

async function initDatabase() {
  if (!db) {
    return false;
  }

  await dbQueryRequired(`
    CREATE TABLE IF NOT EXISTS admin_settings (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await dbQueryRequired(`
    CREATE TABLE IF NOT EXISTS students (
      id TEXT PRIMARY KEY,
      client_id TEXT UNIQUE NOT NULL,
      display_name TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await dbQueryRequired(`
    CREATE TABLE IF NOT EXISTS quiz_sessions (
      id TEXT PRIMARY KEY,
      room_code TEXT NOT NULL,
      status TEXT NOT NULL,
      curriculum TEXT NOT NULL,
      language TEXT NOT NULL,
      subject TEXT NOT NULL,
      grade_level INTEGER NOT NULL,
      difficulty_mode TEXT NOT NULL,
      question_source TEXT NOT NULL,
      questions_per_round INTEGER NOT NULL,
      question_timer_sec INTEGER NOT NULL,
      config JSONB NOT NULL,
      started_at TIMESTAMPTZ,
      ended_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await dbQueryRequired(`
    CREATE TABLE IF NOT EXISTS session_participants (
      session_id TEXT NOT NULL REFERENCES quiz_sessions(id) ON DELETE CASCADE,
      student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      player_id TEXT NOT NULL,
      display_name TEXT NOT NULL,
      is_host BOOLEAN NOT NULL DEFAULT FALSE,
      score INTEGER NOT NULL DEFAULT 0,
      joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (session_id, student_id)
    )
  `);
  await dbQueryRequired(`
    CREATE TABLE IF NOT EXISTS quiz_questions (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES quiz_sessions(id) ON DELETE CASCADE,
      question_index INTEGER NOT NULL,
      curriculum TEXT NOT NULL,
      language TEXT NOT NULL,
      subject TEXT NOT NULL,
      grade_level INTEGER NOT NULL,
      difficulty_mode TEXT NOT NULL,
      source TEXT NOT NULL,
      model TEXT,
      prompt TEXT NOT NULL,
      choices JSONB NOT NULL,
      correct_choice TEXT NOT NULL,
      short_explanation TEXT NOT NULL,
      elaboration TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (session_id, question_index)
    )
  `);
  await dbQueryRequired(`
    CREATE TABLE IF NOT EXISTS student_answers (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES quiz_sessions(id) ON DELETE CASCADE,
      question_id TEXT NOT NULL REFERENCES quiz_questions(id) ON DELETE CASCADE,
      student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      player_id TEXT NOT NULL,
      display_name TEXT NOT NULL,
      choice TEXT,
      is_correct BOOLEAN NOT NULL,
      response_ms INTEGER,
      answered_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (session_id, question_id, student_id)
    )
  `);
  await dbQueryRequired(`
    CREATE TABLE IF NOT EXISTS student_progress (
      student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      curriculum TEXT NOT NULL,
      language TEXT NOT NULL,
      subject TEXT NOT NULL,
      grade_level INTEGER NOT NULL,
      total_sessions INTEGER NOT NULL DEFAULT 0,
      total_questions INTEGER NOT NULL DEFAULT 0,
      correct_answers INTEGER NOT NULL DEFAULT 0,
      last_session_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (student_id, curriculum, language, subject, grade_level)
    )
  `);
  await dbQueryRequired("CREATE INDEX IF NOT EXISTS idx_quiz_sessions_created_at ON quiz_sessions(created_at DESC)");
  await dbQueryRequired("CREATE INDEX IF NOT EXISTS idx_answers_student_created ON student_answers(student_id, created_at DESC)");
  await dbQueryRequired("CREATE INDEX IF NOT EXISTS idx_progress_subject_grade ON student_progress(subject, grade_level)");
  
  // Admin users table for multi-admin support
  await dbQueryRequired(`
    CREATE TABLE IF NOT EXISTS admin_users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'admin',
      email TEXT,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_login_at TIMESTAMPTZ
    )
  `);
  
  // Audit log table
  await dbQueryRequired(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      admin_id TEXT,
      admin_username TEXT NOT NULL,
      action TEXT NOT NULL,
      resource_type TEXT,
      resource_id TEXT,
      details JSONB,
      ip_address TEXT,
      user_agent TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await dbQueryRequired("CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC)");
  await dbQueryRequired("CREATE INDEX IF NOT EXISTS idx_audit_logs_admin ON audit_logs(admin_id, created_at DESC)");
  
  // Question bank table
  await dbQueryRequired(`
    CREATE TABLE IF NOT EXISTS question_bank (
      id TEXT PRIMARY KEY,
      curriculum TEXT NOT NULL,
      language TEXT NOT NULL,
      subject TEXT NOT NULL,
      grade_level INTEGER NOT NULL,
      difficulty_mode TEXT NOT NULL,
      prompt TEXT NOT NULL,
      choices JSONB NOT NULL,
      correct_choice TEXT NOT NULL,
      short_explanation TEXT NOT NULL,
      elaboration TEXT NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      usage_count INTEGER NOT NULL DEFAULT 0,
      created_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await dbQueryRequired("CREATE INDEX IF NOT EXISTS idx_question_bank_lookup ON question_bank(subject, grade_level, is_active)");
  
  // Student blocks table
  await dbQueryRequired(`
    CREATE TABLE IF NOT EXISTS student_blocks (
      id TEXT PRIMARY KEY,
      student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      reason TEXT,
      blocked_by TEXT,
      blocked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ,
      is_active BOOLEAN NOT NULL DEFAULT TRUE
    )
  `);
  await dbQueryRequired("CREATE INDEX IF NOT EXISTS idx_student_blocks_student ON student_blocks(student_id, is_active)");
  
  // Student groups table
  await dbQueryRequired(`
    CREATE TABLE IF NOT EXISTS student_groups (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      created_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  
  await dbQueryRequired(`
    CREATE TABLE IF NOT EXISTS student_group_members (
      group_id TEXT NOT NULL REFERENCES student_groups(id) ON DELETE CASCADE,
      student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      added_by TEXT,
      added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (group_id, student_id)
    )
  `);
  await runDatabaseMigrations();
  await ensureDefaultAdminUser();
  
  return true;
}

async function runDatabaseMigrations() {
  const migrations = [
    "ALTER TABLE students ADD COLUMN IF NOT EXISTS display_name TEXT",
    "ALTER TABLE students ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()",
    "ALTER TABLE students ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()",
    "ALTER TABLE quiz_sessions ADD COLUMN IF NOT EXISTS config JSONB",
    "ALTER TABLE quiz_sessions ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ",
    "ALTER TABLE quiz_sessions ADD COLUMN IF NOT EXISTS ended_at TIMESTAMPTZ",
    "ALTER TABLE session_participants ADD COLUMN IF NOT EXISTS is_host BOOLEAN NOT NULL DEFAULT FALSE",
    "ALTER TABLE session_participants ADD COLUMN IF NOT EXISTS score INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE session_participants ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()",
    "ALTER TABLE quiz_questions ADD COLUMN IF NOT EXISTS model TEXT",
    "ALTER TABLE quiz_questions ADD COLUMN IF NOT EXISTS elaboration TEXT",
    "ALTER TABLE student_answers ADD COLUMN IF NOT EXISTS response_ms INTEGER",
    "ALTER TABLE student_answers ADD COLUMN IF NOT EXISTS answered_at TIMESTAMPTZ",
    "ALTER TABLE question_bank ADD COLUMN IF NOT EXISTS curriculum TEXT",
    "ALTER TABLE question_bank ADD COLUMN IF NOT EXISTS language TEXT",
    "ALTER TABLE question_bank ADD COLUMN IF NOT EXISTS difficulty_mode TEXT",
    "ALTER TABLE question_bank ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE",
    "ALTER TABLE question_bank ADD COLUMN IF NOT EXISTS usage_count INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE question_bank ADD COLUMN IF NOT EXISTS created_by TEXT",
    "ALTER TABLE question_bank ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()"
  ];

  for (const migration of migrations) {
    await dbQueryRequired(migration);
  }

  await dbQueryRequired(`
    UPDATE question_bank
    SET curriculum = COALESCE(curriculum, $1),
        language = COALESCE(language, $2),
        difficulty_mode = COALESCE(difficulty_mode, $3),
        elaboration = COALESCE(elaboration, short_explanation, '')
  `, [defaultGameConfig.curriculum, defaultGameConfig.language, defaultGameConfig.difficultyMode]);
}

async function ensureDefaultAdminUser() {
  if (!ADMIN_PASSWORD) {
    return;
  }

  await dbQueryRequired(
    `INSERT INTO admin_users (id, username, password_hash, role, is_active, created_at, updated_at)
     VALUES ($1, $2, $3, $4, TRUE, NOW(), NOW())
     ON CONFLICT (username) DO UPDATE
       SET password_hash = EXCLUDED.password_hash,
           role = EXCLUDED.role,
           is_active = TRUE,
           updated_at = NOW()`,
    [createId(), ADMIN_USERNAME, hashPassword(ADMIN_PASSWORD), "admin"]
  );
}

async function loadDbConfig() {
  const result = await dbQuery("SELECT value FROM admin_settings WHERE key = $1", ["game_config"]);
  return result && result.rows[0] ? result.rows[0].value : null;
}

async function persistDbConfig(nextConfig) {
  if (!db) {
    return;
  }

  await dbQueryRequired(
    `INSERT INTO admin_settings (key, value, updated_at)
     VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    ["game_config", JSON.stringify(nextConfig)]
  );
}

function sanitizeStudentName(value) {
  const trimmed = String(value || "").replace(/\s+/g, " ").trim();
  return (trimmed || "Student").slice(0, 48);
}

async function upsertStudent(clientId, displayName) {
  if (!db || !clientId) {
    return null;
  }

  const existing = await dbQuery(
    `SELECT id FROM students WHERE client_id = $1`,
    [clientId]
  );
  const studentId = existing && existing.rows[0] ? existing.rows[0].id : createId();
  await dbQuery(
    `INSERT INTO students (id, client_id, display_name, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (client_id) DO UPDATE
       SET display_name = EXCLUDED.display_name, updated_at = NOW()
     RETURNING id`,
    [studentId, clientId, sanitizeStudentName(displayName)]
  );
  return studentId;
}

async function getActiveStudentBlock(studentId) {
  if (!db || !studentId) {
    return null;
  }

  const result = await dbQuery(
    `SELECT reason, expires_at
     FROM student_blocks
     WHERE student_id = $1
       AND is_active = TRUE
       AND (expires_at IS NULL OR expires_at > NOW())
     ORDER BY blocked_at DESC
     LIMIT 1`,
    [studentId]
  );
  return result?.rows?.[0] || null;
}

async function loadStudentAnswerHistory(studentId, limit = 10) {
  if (!db || !studentId) {
    return [];
  }

  const result = await dbQuery(
    `SELECT a.choice,
            a.is_correct,
            q.question_index,
            q.prompt,
            q.correct_choice,
            q.short_explanation,
            q.elaboration
     FROM student_answers a
     JOIN quiz_questions q ON q.id = a.question_id
     WHERE a.student_id = $1
     ORDER BY a.created_at DESC
     LIMIT $2`,
    [studentId, limit]
  );

  return (result?.rows || []).reverse().map((row) => ({
    questionIndex: row.question_index,
    prompt: row.prompt,
    choice: row.choice,
    correctChoice: row.correct_choice,
    isCorrect: Boolean(row.is_correct),
    shortExplanation: row.short_explanation || "",
    elaboration: row.elaboration || "",
    scoreAfter: null
  }));
}

async function persistSessionCreated(room) {
  if (!db || !room) {
    return null;
  }

  const sessionId = createId();
  await dbQuery(
    `INSERT INTO quiz_sessions (
      id, room_code, status, curriculum, language, subject, grade_level,
      difficulty_mode, question_source, questions_per_round, question_timer_sec,
      config, created_at, updated_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, NOW(), NOW())`,
    [
      sessionId,
      room.roomCode,
      room.status,
      gameConfig.curriculum,
      gameConfig.language,
      gameConfig.subject,
      gameConfig.gradeLevel,
      gameConfig.difficultyMode,
      gameConfig.questionSource,
      gameConfig.questionsPerRound,
      gameConfig.questionTimerSec,
      JSON.stringify(gameConfig)
    ]
  );
  return sessionId;
}

async function persistSessionStatus(room, status) {
  if (!db || !room || !room.sessionId) {
    return;
  }

  const startedAt = status === "LOADING" || status === "ANSWERING" || status === "REVIEWING"
    ? "COALESCE(started_at, NOW())"
    : "started_at";
  const endedAt = status === "FINISHED" || status === "CLOSED" ? "NOW()" : "ended_at";
  await dbQuery(
    `UPDATE quiz_sessions
     SET status = $2, updated_at = NOW(), started_at = ${startedAt}, ended_at = ${endedAt}
     WHERE id = $1`,
    [room.sessionId, status]
  );
}

async function persistParticipant(room, player) {
  if (!db || !room || !room.sessionId || !player) {
    return;
  }

  const studentId = await upsertStudent(player.clientId || `${room.roomCode}:${player.playerId}`, player.name);
  player.studentId = studentId;
  if (!player.answerHistory || player.answerHistory.length === 0) {
    player.answerHistory = await loadStudentAnswerHistory(studentId);
  }
  await dbQuery(
    `INSERT INTO session_participants (
      session_id, student_id, player_id, display_name, is_host, score, joined_at, last_seen_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
    ON CONFLICT (session_id, student_id) DO UPDATE
      SET player_id = EXCLUDED.player_id,
          display_name = EXCLUDED.display_name,
          is_host = EXCLUDED.is_host,
          score = EXCLUDED.score,
          last_seen_at = NOW()`,
    [room.sessionId, studentId, player.playerId, sanitizeStudentName(player.name), Boolean(player.isHost), player.score || 0]
  );
}

async function persistQuestion(room) {
  if (!db || !room || !room.sessionId || !room.currentQuestion) {
    return null;
  }

  const questionId = createId();
  const result = await dbQuery(
    `INSERT INTO quiz_questions (
      id, session_id, question_index, curriculum, language, subject, grade_level,
      difficulty_mode, source, model, prompt, choices, correct_choice,
      short_explanation, elaboration
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14, $15)
    ON CONFLICT (session_id, question_index) DO UPDATE
      SET prompt = EXCLUDED.prompt,
          choices = EXCLUDED.choices,
          correct_choice = EXCLUDED.correct_choice,
          short_explanation = EXCLUDED.short_explanation,
          elaboration = EXCLUDED.elaboration
    RETURNING id`,
    [
      questionId,
      room.sessionId,
      room.questionIndex,
      gameConfig.curriculum,
      gameConfig.language,
      room.currentQuestion.subject || gameConfig.subject,
      gameConfig.gradeLevel,
      gameConfig.difficultyMode,
      room.currentQuestion.source || "openai",
      room.currentQuestion.model || OPENAI_MODEL,
      room.currentQuestion.question,
      JSON.stringify(room.currentQuestion.choices),
      room.currentQuestion.correctChoice,
      room.currentQuestion.shortExplanation,
      room.currentQuestion.elaboration
    ]
  );
  return result?.rows[0]?.id || questionId;
}

async function persistRevealResults(room) {
  if (!db || !room || !room.sessionId || !room.currentQuestionId || !room.currentQuestion) {
    return;
  }

  for (const player of room.players.values()) {
    if (player.isHost && !player.currentAnswer) {
      continue;
    }

    if (!player.isHost && player.activeQuestionIndex !== room.questionIndex && !player.currentAnswer) {
      continue;
    }

    await persistParticipant(room, player);
    const isCorrect = player.currentAnswer === room.currentQuestion.correctChoice;
    await dbQuery(
      `INSERT INTO student_answers (
        id, session_id, question_id, student_id, player_id, display_name,
        choice, is_correct, response_ms, answered_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (session_id, question_id, student_id) DO UPDATE
        SET choice = EXCLUDED.choice,
            is_correct = EXCLUDED.is_correct,
            response_ms = EXCLUDED.response_ms,
            answered_at = EXCLUDED.answered_at,
            display_name = EXCLUDED.display_name`,
      [
        createId(),
        room.sessionId,
        room.currentQuestionId,
        player.studentId,
        player.playerId,
        sanitizeStudentName(player.name),
        player.currentAnswer || null,
        isCorrect,
        player.answerResponseMs || null,
        player.answerSubmittedAt || null
      ]
    );
    await dbQuery(
      `UPDATE session_participants
       SET score = $3, display_name = $4, last_seen_at = NOW()
       WHERE session_id = $1 AND student_id = $2`,
      [room.sessionId, player.studentId, player.score || 0, sanitizeStudentName(player.name)]
    );
    await dbQuery(
      `INSERT INTO student_progress (
        student_id, curriculum, language, subject, grade_level,
        total_sessions, total_questions, correct_answers, last_session_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, 1, 1, $6, NOW(), NOW())
      ON CONFLICT (student_id, curriculum, language, subject, grade_level) DO UPDATE
        SET total_questions = student_progress.total_questions + 1,
            correct_answers = student_progress.correct_answers + EXCLUDED.correct_answers,
            last_session_at = NOW(),
            updated_at = NOW()`,
      [
        player.studentId,
        gameConfig.curriculum,
        gameConfig.language,
        room.currentQuestion.subject || gameConfig.subject,
        gameConfig.gradeLevel,
        isCorrect ? 1 : 0
      ]
    );
  }
}

async function markProgressSession(room) {
  if (!db || !room || !room.sessionId) {
    return;
  }

  for (const player of room.players.values()) {
    if (player.isHost || !player.studentId) {
      continue;
    }

    await dbQuery(
      `INSERT INTO student_progress (
        student_id, curriculum, language, subject, grade_level,
        total_sessions, total_questions, correct_answers, last_session_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, 1, 0, 0, NOW(), NOW())
      ON CONFLICT (student_id, curriculum, language, subject, grade_level) DO UPDATE
        SET total_sessions = student_progress.total_sessions + 1,
            last_session_at = NOW(),
            updated_at = NOW()`,
      [player.studentId, gameConfig.curriculum, gameConfig.language, gameConfig.subject, gameConfig.gradeLevel]
    );
  }
}

app.use(express.json());
app.use((req, res, next) => {
  const origin = req.get("origin");
  const isAdminRequest = req.path.startsWith("/admin");
  const allowedAdminOrigin = !origin || ADMIN_ALLOWED_ORIGINS.includes(origin);
  res.setHeader("Access-Control-Allow-Origin", isAdminRequest ? (allowedAdminOrigin ? origin || "null" : "null") : "*");
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Admin-Token");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");

  if (req.method === "OPTIONS") {
    res.status(allowedAdminOrigin ? 204 : 403).end();
    return;
  }

  if (isAdminRequest && !allowedAdminOrigin) {
    res.status(403).json({ error: "Admin origin is not allowed" });
    return;
  }

  next();
});
app.use(rateLimitAdmin);

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    version: APP_VERSION,
    startedAt,
    uptimeSec: Math.round(process.uptime()),
    rooms: rooms.size,
    adminConfigured: Boolean(ADMIN_TOKEN),
    openaiConfigured: Boolean(OPENAI_API_KEY),
    openaiModel: OPENAI_MODEL,
    databaseConfigured: Boolean(db),
    configPath: CONFIG_PATH,
    configPersisted: fs.existsSync(CONFIG_PATH)
  });
});

app.get("/config", (_req, res) => {
  res.json({
    ...gameConfig,
    supportedCurriculums: SUPPORTED_CURRICULUMS,
    supportedLanguages: SUPPORTED_LANGUAGES,
    supportedSubjects: SUPPORTED_SUBJECTS,
    supportedDifficultyModes: SUPPORTED_DIFFICULTY_MODES,
    supportedQuestionSources: SUPPORTED_QUESTION_SOURCES,
    minGradeLevel: MIN_GRADE_LEVEL,
    maxGradeLevel: MAX_GRADE_LEVEL
  });
});

async function isAuthorized(req) {
  if (!ADMIN_TOKEN) {
    return false;
  }

  const headerToken = req.get("authorization")?.replace(/^Bearer\s+/i, "");
  const fallbackToken = req.get("x-admin-token");
  const token = headerToken || fallbackToken;
  if (!token) {
    return false;
  }

  if (token === ADMIN_TOKEN) {
    req.adminUser = { username: "token-admin", role: "admin" };
    return true;
  }

  const session = verifyAdminSession(token);
  if (!session) {
    return false;
  }

  req.adminUser = session;
  return true;
}

async function requireAdmin(req, res, next) {
  try {
    if (!(await isAuthorized(req))) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    next();
  } catch (error) {
    console.error("Admin authorization failed:", error);
    res.status(401).json({ error: "Unauthorized" });
  }
}

app.post("/admin/login", async (req, res) => {
  if (!requireDatabase(res)) {
    return;
  }
  if (!ADMIN_TOKEN) {
    res.status(503).json({ error: "ADMIN_TOKEN is required for signed admin sessions" });
    return;
  }

  try {
    const username = String(req.body?.username || "").trim();
    const password = String(req.body?.password || "");
    if (!username || !password) {
      res.status(400).json({ error: "Username and password are required" });
      return;
    }

    const result = await dbQueryRequired(
      `SELECT id, username, password_hash, role
       FROM admin_users
       WHERE username = $1 AND is_active = TRUE`,
      [username]
    );
    const user = result.rows[0];
    if (!user || !verifyPassword(password, user.password_hash)) {
      res.status(401).json({ error: "Invalid admin login" });
      return;
    }

    await dbQueryRequired("UPDATE admin_users SET last_login_at = NOW() WHERE id = $1", [user.id]);
    req.adminUser = { username: user.username, role: user.role };
    await logAuditAction("admin.login", "admin_users", user.id, { username: user.username }, req);
    res.json({
      ok: true,
      token: signAdminSession(user),
      user: {
        username: user.username,
        role: user.role
      }
    });
  } catch (error) {
    console.error("Admin login failed:", error);
    res.status(500).json({ error: "Admin login failed" });
  }
});

function finiteNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function sanitizeConfig(input) {
  const nextConfig = {
    brandTitle: String(input.brandTitle ?? defaultGameConfig.brandTitle).trim() || defaultGameConfig.brandTitle,
    brandCaption: String(input.brandCaption ?? defaultGameConfig.brandCaption).trim() || defaultGameConfig.brandCaption,
    curriculum: String(input.curriculum ?? defaultGameConfig.curriculum).trim().toLowerCase() || defaultGameConfig.curriculum,
    language: String(input.language ?? defaultGameConfig.language).trim().toLowerCase() || defaultGameConfig.language,
    subject: String(input.subject ?? defaultGameConfig.subject).trim().toLowerCase() || defaultGameConfig.subject,
    gradeLevel: finiteNumber(input.gradeLevel ?? defaultGameConfig.gradeLevel, defaultGameConfig.gradeLevel),
    difficultyMode: String(input.difficultyMode ?? defaultGameConfig.difficultyMode).trim().toLowerCase() || defaultGameConfig.difficultyMode,
    questionSource: String(input.questionSource ?? defaultGameConfig.questionSource).trim().toLowerCase() || defaultGameConfig.questionSource,
    questionsPerRound: finiteNumber(input.questionsPerRound ?? defaultGameConfig.questionsPerRound, defaultGameConfig.questionsPerRound),
    questionTimerSec: finiteNumber(input.questionTimerSec ?? defaultGameConfig.questionTimerSec, defaultGameConfig.questionTimerSec)
  };

  nextConfig.curriculum = SUPPORTED_CURRICULUMS.includes(nextConfig.curriculum) ? nextConfig.curriculum : "international";
  nextConfig.language = SUPPORTED_LANGUAGES.includes(nextConfig.language) ? nextConfig.language : "english";
  nextConfig.subject = SUPPORTED_SUBJECTS.includes(nextConfig.subject) ? nextConfig.subject : "math";
  nextConfig.gradeLevel = Math.min(MAX_GRADE_LEVEL, Math.max(MIN_GRADE_LEVEL, Math.round(nextConfig.gradeLevel)));
  nextConfig.difficultyMode = SUPPORTED_DIFFICULTY_MODES.includes(nextConfig.difficultyMode) ? nextConfig.difficultyMode : "standard";
  nextConfig.questionSource = SUPPORTED_QUESTION_SOURCES.includes(nextConfig.questionSource) ? nextConfig.questionSource : "openai_fallback";
  nextConfig.questionsPerRound = Math.min(20, Math.max(3, Math.round(nextConfig.questionsPerRound)));
  nextConfig.questionTimerSec = Math.min(90, Math.max(10, Math.round(nextConfig.questionTimerSec)));

  return nextConfig;
}

function normalizeAdminText(value, maxLength, fallback = "") {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return (text || fallback).slice(0, maxLength);
}

function normalizeAdminId(value, label = "id") {
  const id = String(value || "").trim();
  requireValid(/^[a-z0-9:_-]{1,80}$/i.test(id), `Invalid ${label}`);
  return id;
}

function validateQuestionPayload(input, options = {}) {
  const payload = input || {};
  const curriculum = String(payload.curriculum ?? gameConfig.curriculum).trim().toLowerCase();
  const language = String(payload.language ?? gameConfig.language).trim().toLowerCase();
  const subject = String(payload.subject ?? gameConfig.subject).trim().toLowerCase();
  const gradeLevel = Math.round(Number(payload.grade_level ?? payload.gradeLevel ?? gameConfig.gradeLevel));
  const difficultyMode = String(payload.difficulty_mode ?? payload.difficultyMode ?? gameConfig.difficultyMode).trim().toLowerCase();
  const prompt = normalizeAdminText(payload.prompt, 600);
  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  const correctChoice = String(payload.correct_choice ?? payload.correctChoice ?? "").trim().toUpperCase();
  const shortExplanation = normalizeAdminText(payload.short_explanation ?? payload.shortExplanation, 300);
  const elaboration = normalizeAdminText(payload.elaboration, 1200);

  requireValid(SUPPORTED_CURRICULUMS.includes(curriculum), "Unsupported curriculum");
  requireValid(SUPPORTED_LANGUAGES.includes(language), "Unsupported language");
  requireValid(SUPPORTED_SUBJECTS.includes(subject), "Unsupported subject");
  requireValid(gradeLevel >= MIN_GRADE_LEVEL && gradeLevel <= MAX_GRADE_LEVEL, `Grade level must be ${MIN_GRADE_LEVEL}-${MAX_GRADE_LEVEL}`);
  requireValid(SUPPORTED_DIFFICULTY_MODES.includes(difficultyMode), "Unsupported difficulty mode");
  requireValid(prompt.length >= 5, "Question prompt is required");
  requireValid(choices.length === 4, "Exactly four choices are required");
  requireValid(["A", "B", "C", "D"].includes(correctChoice), "Correct choice must be A, B, C, or D");
  requireValid(shortExplanation.length >= 3, "Short explanation is required");
  requireValid(elaboration.length >= 3, "Elaboration is required");

  const normalizedChoices = ["A", "B", "C", "D"].map((id) => {
    const choice = choices.find((item) => String(item?.id || "").toUpperCase() === id);
    const text = normalizeAdminText(choice?.text, 300);
    requireValid(text.length > 0, `Choice ${id} text is required`);
    return { id, text };
  });

  return {
    curriculum,
    language,
    subject,
    gradeLevel,
    difficultyMode,
    prompt,
    choices: normalizedChoices,
    correctChoice,
    shortExplanation,
    elaboration,
    isActive: options.allowActiveFlag ? payload.is_active !== false : true
  };
}

function validateExpiry(value) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  requireValid(!Number.isNaN(date.getTime()), "Invalid expiry date");
  requireValid(date.getTime() > Date.now(), "Expiry date must be in the future");
  return date.toISOString();
}

function send(ws, payload) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function createPlayerId() {
  return `P${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
}

function normalizeClientId(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-z0-9_-]/gi, "")
    .slice(0, 48);
}

function getOrCreatePlayerName(room, requestedName) {
  const trimmed = String(requestedName || "").trim();
  if (trimmed) {
    return trimmed.slice(0, 24);
  }

  let number = room.playerSequence || 1;
  let candidate = `Student ${number}`;

  while ([...room.players.values()].some((player) => player.name === candidate)) {
    number += 1;
    candidate = `Student ${number}`;
  }

  room.playerSequence = number + 1;
  return candidate;
}

function getLeaderboard(room) {
  return [...room.players.values()]
    .map((player) => ({
      playerId: player.playerId,
      name: player.name,
      score: player.score,
      connected: player.isHost
        ? Boolean(room.tv && room.tv.readyState === WebSocket.OPEN)
        : Boolean(player.ws && player.ws.readyState === WebSocket.OPEN),
      lastAnswer: room.revealAnswer ? player.currentAnswer || null : null
    }))
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return left.name.localeCompare(right.name);
    });
}

function buildRoomState(roomCode, viewerWs = null) {
  const room = rooms.get(roomCode);
  if (!room) {
    return null;
  }

  let viewerPlayer = null;
  if (viewerWs === room.tv && room.hostPlayerId) {
    viewerPlayer = room.players.get(room.hostPlayerId) || null;
  } else if (viewerWs && viewerWs.meta && viewerWs.meta.playerId) {
    viewerPlayer = room.players.get(viewerWs.meta.playerId) || null;
  }

  const question = room.currentQuestion
    ? {
        prompt: room.currentQuestion.question,
        choices: room.currentQuestion.choices
      }
    : null;

  return {
    roomCode,
    status: room.status,
    config: gameConfig,
    playerCount: room.players.size,
    connectedPlayerCount:
      [...room.players.values()].filter((player) => player.isHost
        ? Boolean(room.tv && room.tv.readyState === WebSocket.OPEN)
        : Boolean(player.ws && player.ws.readyState === WebSocket.OPEN)).length,
    questionIndex: room.questionIndex,
    questionsPerRound: gameConfig.questionsPerRound,
    score: room.score,
    selectedChoice: viewerPlayer ? viewerPlayer.currentAnswer || null : null,
    correctChoice: room.revealAnswer ? room.currentQuestion?.correctChoice || null : null,
    shortExplanation: room.revealAnswer ? room.currentQuestion?.shortExplanation || "" : "",
    elaboration: room.revealAnswer ? room.currentQuestion?.elaboration || "" : "",
    deadlineAt: room.deadlineAt,
    answerCount: room.answerCount || 0,
    leaderboard: getLeaderboard(room),
    player: viewerPlayer
      ? {
          playerId: viewerPlayer.playerId,
          name: viewerPlayer.name,
          score: viewerPlayer.score,
          answered: viewerPlayer.answeredQuestionIndex === room.questionIndex && room.status === "ANSWERING",
          results: viewerPlayer.answerHistory || []
        }
      : null,
    question
  };
}

function broadcastRoomState(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) {
    return;
  }

  send(room.tv, {
    type: "room_state",
    state: buildRoomState(roomCode, room.tv)
  });

  for (const player of room.players.values()) {
    send(player.ws, {
      type: "room_state",
      state: buildRoomState(roomCode, player.ws)
    });
  }
}

function broadcastConfig() {
  for (const roomCode of rooms.keys()) {
    broadcastRoomState(roomCode);
  }
}

app.get("/admin/config", requireAdmin, (_req, res) => {
  res.json(gameConfig);
});

app.put("/admin/config", requireAdmin, async (req, res) => {
  await runAdminAction(res, async () => {
    const nextConfig = sanitizeConfig(req.body || {});
    Object.assign(gameConfig, nextConfig);
    const persisted = persistConfig(gameConfig);
    await persistDbConfig(gameConfig);
    await logAuditAction("config.update", "admin_settings", "game_config", nextConfig, req);
    broadcastConfig();
    res.json({
      ok: true,
      persisted,
      config: gameConfig
    });
  });
});

function getReportLimit(value, fallback = 25) {
  const parsed = Number(value || fallback);
  return Math.min(100, Math.max(1, Math.round(parsed)));
}

function requireDatabase(res) {
  if (!db) {
    res.status(503).json({
      error: "Postgres is not configured. Add DATABASE_URL to the gateway service."
    });
    return false;
  }

  return true;
}

function getAdminUsername(req) {
  return req.adminUser?.username || req.get("x-admin-user") || "admin";
}

async function runAdminAction(res, action) {
  try {
    await action();
  } catch (error) {
    console.error("Admin action failed:", error);
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : "Database operation failed" });
  }
}

app.get("/admin/reports/overview", requireAdmin, async (_req, res) => {
  if (!requireDatabase(res)) {
    return;
  }

  const [sessions, students, answers, progress] = await Promise.all([
    dbQuery("SELECT COUNT(*)::int AS count FROM quiz_sessions"),
    dbQuery("SELECT COUNT(*)::int AS count FROM students WHERE client_id NOT LIKE 'tv:%'"),
    dbQuery("SELECT COUNT(*)::int AS total, COALESCE(SUM(CASE WHEN is_correct THEN 1 ELSE 0 END), 0)::int AS correct FROM student_answers"),
    dbQuery(`
      SELECT subject, grade_level, SUM(total_questions)::int AS total_questions,
             SUM(correct_answers)::int AS correct_answers
      FROM student_progress
      GROUP BY subject, grade_level
      ORDER BY grade_level, subject
      LIMIT 12
    `)
  ]);

  const totalAnswers = answers?.rows[0]?.total || 0;
  const correctAnswers = answers?.rows[0]?.correct || 0;
  res.json({
    databaseConfigured: true,
    sessions: sessions?.rows[0]?.count || 0,
    students: students?.rows[0]?.count || 0,
    answers: totalAnswers,
    accuracy: totalAnswers ? Math.round((correctAnswers / totalAnswers) * 100) : 0,
    progress: progress?.rows || []
  });
});

app.get("/admin/reports/sessions", requireAdmin, async (req, res) => {
  if (!requireDatabase(res)) {
    return;
  }

  const limit = getReportLimit(req.query.limit);
  const result = await dbQuery(
    `SELECT s.id, s.room_code, s.status, s.curriculum, s.language, s.subject,
            s.grade_level, s.difficulty_mode, s.question_source, s.created_at,
            s.started_at, s.ended_at,
            COUNT(DISTINCT p.student_id)::int AS participants,
            COUNT(a.id)::int AS answers,
            COALESCE(SUM(CASE WHEN a.is_correct THEN 1 ELSE 0 END), 0)::int AS correct_answers
     FROM quiz_sessions s
     LEFT JOIN session_participants p ON p.session_id = s.id AND p.is_host = FALSE
     LEFT JOIN student_answers a ON a.session_id = s.id
     GROUP BY s.id
     ORDER BY s.created_at DESC
     LIMIT $1`,
    [limit]
  );
  res.json({ sessions: result?.rows || [] });
});

app.get("/admin/reports/students", requireAdmin, async (req, res) => {
  if (!requireDatabase(res)) {
    return;
  }

  const limit = getReportLimit(req.query.limit);
  const result = await dbQuery(
    `SELECT st.id, st.display_name, st.client_id, st.created_at, st.updated_at,
            COALESCE(SUM(sp.total_sessions), 0)::int AS total_sessions,
            COALESCE(SUM(sp.total_questions), 0)::int AS total_questions,
            COALESCE(SUM(sp.correct_answers), 0)::int AS correct_answers,
            MAX(sp.last_session_at) AS last_session_at
     FROM students st
     LEFT JOIN student_progress sp ON sp.student_id = st.id
     WHERE st.client_id NOT LIKE 'tv:%'
     GROUP BY st.id
     ORDER BY last_session_at DESC NULLS LAST, st.updated_at DESC
     LIMIT $1`,
    [limit]
  );
  res.json({ students: result?.rows || [] });
});

app.get("/admin/reports/sessions/:sessionId", requireAdmin, async (req, res) => {
  if (!requireDatabase(res)) {
    return;
  }

  const sessionId = String(req.params.sessionId || "");
  const [session, participants, questions, answers] = await Promise.all([
    dbQuery("SELECT * FROM quiz_sessions WHERE id = $1", [sessionId]),
    dbQuery(
      `SELECT p.*, st.display_name AS student_name
       FROM session_participants p
       JOIN students st ON st.id = p.student_id
       WHERE p.session_id = $1
       ORDER BY p.score DESC, p.display_name`,
      [sessionId]
    ),
    dbQuery(
      `SELECT id, question_index, subject, grade_level, prompt, choices,
              correct_choice, short_explanation, elaboration, source, model, created_at
       FROM quiz_questions
       WHERE session_id = $1
       ORDER BY question_index`,
      [sessionId]
    ),
    dbQuery(
      `SELECT a.*, q.question_index, q.prompt, q.correct_choice, q.short_explanation, q.elaboration
       FROM student_answers a
       JOIN quiz_questions q ON q.id = a.question_id
       WHERE a.session_id = $1
       ORDER BY q.question_index, a.display_name`,
      [sessionId]
    )
  ]);

  if (!session?.rows[0]) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  res.json({
    session: session.rows[0],
    participants: participants?.rows || [],
    questions: questions?.rows || [],
    answers: answers?.rows || []
  });
});

app.get("/admin/reports/students/:studentId", requireAdmin, async (req, res) => {
  if (!requireDatabase(res)) {
    return;
  }

  const studentId = String(req.params.studentId || "");
  const [student, progress, answers] = await Promise.all([
    dbQuery("SELECT id, display_name, client_id, created_at, updated_at FROM students WHERE id = $1", [studentId]),
    dbQuery(
      `SELECT curriculum, language, subject, grade_level, total_sessions,
              total_questions, correct_answers, last_session_at, updated_at
       FROM student_progress
       WHERE student_id = $1
       ORDER BY grade_level, subject, curriculum, language`,
      [studentId]
    ),
    dbQuery(
      `SELECT a.choice, a.is_correct, a.response_ms, a.answered_at,
              s.room_code, s.curriculum, s.language, s.subject, s.grade_level,
              q.question_index, q.prompt, q.correct_choice, q.short_explanation, q.elaboration
       FROM student_answers a
       JOIN quiz_sessions s ON s.id = a.session_id
       JOIN quiz_questions q ON q.id = a.question_id
       WHERE a.student_id = $1
       ORDER BY a.created_at DESC
       LIMIT 100`,
      [studentId]
    )
  ]);

  if (!student?.rows[0]) {
    res.status(404).json({ error: "Student not found" });
    return;
  }

  res.json({
    student: student.rows[0],
    progress: progress?.rows || [],
    answers: answers?.rows || []
  });
});

app.post("/admin/reports/sessions/cleanup", requireAdmin, async (req, res) => {
  if (!requireDatabase(res)) {
    return;
  }

  await runAdminAction(res, async () => {
    requireValid(req.body?.confirm === "DELETE_OLD_SESSIONS", "Cleanup confirmation is required");
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const result = await dbQueryRequired(
      `DELETE FROM quiz_sessions WHERE created_at < $1 RETURNING id`,
      [thirtyDaysAgo.toISOString()]
    );

    const deletedCount = result?.rows?.length || 0;
    await logAuditAction("reports.cleanup", "quiz_sessions", null, { deletedCount }, req);
    res.json({
      ok: true,
      deleted: deletedCount,
      message: `Successfully deleted ${deletedCount} session(s) older than 30 days.`
    });
  });
});

// Question Bank Management
app.get("/admin/questions", requireAdmin, async (req, res) => {
  if (!requireDatabase(res)) {
    return;
  }

  const limit = getReportLimit(req.query.limit, 100);
  const subject = req.query.subject || "";
  const gradeLevel = req.query.gradeLevel ? Number(req.query.gradeLevel) : null;
  
  let query = `SELECT * FROM question_bank WHERE is_active = TRUE`;
  const params = [];
  let paramIndex = 1;
  
  if (subject) {
    params.push(subject);
    query += ` AND subject = $${paramIndex++}`;
  }
  if (gradeLevel) {
    params.push(gradeLevel);
    query += ` AND grade_level = $${paramIndex++}`;
  }
  
  query += ` ORDER BY created_at DESC LIMIT $${paramIndex}`;
  params.push(limit);
  
  const result = await dbQueryRequired(query, params);
  res.json({ questions: result?.rows || [] });
});

app.post("/admin/questions", requireAdmin, async (req, res) => {
  if (!requireDatabase(res)) {
    return;
  }

  await runAdminAction(res, async () => {
    const question = validateQuestionPayload(req.body);
    
    const questionId = createId();
    await dbQueryRequired(
      `INSERT INTO question_bank (
        id, curriculum, language, subject, grade_level, difficulty_mode,
        prompt, choices, correct_choice, short_explanation, elaboration, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12)`,
      [
        questionId,
        question.curriculum,
        question.language,
        question.subject,
        question.gradeLevel,
        question.difficultyMode,
        question.prompt,
        JSON.stringify(question.choices),
        question.correctChoice,
        question.shortExplanation,
        question.elaboration,
        getAdminUsername(req)
      ]
    );
    await logAuditAction("question.create", "question_bank", questionId, { subject: question.subject, grade_level: question.gradeLevel }, req);
    
    res.json({ ok: true, id: questionId });
  });
});

app.put("/admin/questions/:id", requireAdmin, async (req, res) => {
  if (!requireDatabase(res)) {
    return;
  }

  await runAdminAction(res, async () => {
    const questionId = normalizeAdminId(req.params.id, "question id");
    const question = validateQuestionPayload(req.body, { allowActiveFlag: true });
    
    const result = await dbQueryRequired(
      `UPDATE question_bank SET 
        curriculum = $2,
        language = $3,
        subject = $4,
        grade_level = $5,
        difficulty_mode = $6,
        prompt = $7,
        choices = $8::jsonb,
        correct_choice = $9,
        short_explanation = $10,
        elaboration = $11,
        is_active = $12,
        updated_at = NOW()
       WHERE id = $1`,
      [
        questionId,
        question.curriculum,
        question.language,
        question.subject,
        question.gradeLevel,
        question.difficultyMode,
        question.prompt,
        JSON.stringify(question.choices),
        question.correctChoice,
        question.shortExplanation,
        question.elaboration,
        question.isActive
      ]
    );
    if (result.rowCount === 0) {
      res.status(404).json({ error: "Question not found" });
      return;
    }
    await logAuditAction("question.update", "question_bank", questionId, { is_active: question.isActive }, req);
    
    res.json({ ok: true });
  });
});

app.delete("/admin/questions/:id", requireAdmin, async (req, res) => {
  if (!requireDatabase(res)) {
    return;
  }

  await runAdminAction(res, async () => {
    const questionId = normalizeAdminId(req.params.id, "question id");
    const result = await dbQueryRequired(`UPDATE question_bank SET is_active = FALSE WHERE id = $1`, [questionId]);
    if (result.rowCount === 0) {
      res.status(404).json({ error: "Question not found" });
      return;
    }
    await logAuditAction("question.delete", "question_bank", questionId, null, req);
    res.json({ ok: true });
  });
});

// Student Management
app.put("/admin/students/:id", requireAdmin, async (req, res) => {
  if (!requireDatabase(res)) {
    return;
  }

  await runAdminAction(res, async () => {
    const studentId = normalizeAdminId(req.params.id, "student id");
    const { display_name } = req.body;
    const nextName = sanitizeStudentName(display_name);
    requireValid(nextName.length > 0, "Student name is required");
    
    const result = await dbQueryRequired(
      `UPDATE students SET display_name = $2, updated_at = NOW() WHERE id = $1`,
      [studentId, nextName]
    );
    if (result.rowCount === 0) {
      res.status(404).json({ error: "Student not found" });
      return;
    }
    await logAuditAction("student.update", "students", studentId, { display_name: nextName }, req);
    
    res.json({ ok: true });
  });
});

app.post("/admin/students/:id/block", requireAdmin, async (req, res) => {
  if (!requireDatabase(res)) {
    return;
  }

  await runAdminAction(res, async () => {
    const studentId = normalizeAdminId(req.params.id, "student id");
    const { reason, expires_at } = req.body;
    const blockReason = normalizeAdminText(reason, 300, "Blocked by admin");
    const expiresAt = validateExpiry(expires_at);
    
    const blockId = createId();
    await dbQueryRequired(
      `INSERT INTO student_blocks (id, student_id, reason, blocked_by, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [blockId, studentId, blockReason, getAdminUsername(req), expiresAt]
    );
    await logAuditAction("student.block", "students", studentId, { reason: blockReason, expires_at: expiresAt }, req);
    
    res.json({ ok: true, blockId });
  });
});

app.delete("/admin/students/:id/block", requireAdmin, async (req, res) => {
  if (!requireDatabase(res)) {
    return;
  }

  await runAdminAction(res, async () => {
    const studentId = normalizeAdminId(req.params.id, "student id");
    const result = await dbQueryRequired(`UPDATE student_blocks SET is_active = FALSE WHERE student_id = $1 AND is_active = TRUE`, [studentId]);
    await logAuditAction("student.unblock", "students", studentId, { unblocked: result.rowCount }, req);
    res.json({ ok: true, unblocked: result.rowCount });
  });
});

// Student Groups
app.get("/admin/groups", requireAdmin, async (req, res) => {
  if (!requireDatabase(res)) {
    return;
  }

  const result = await dbQueryRequired(`
    SELECT g.*, COUNT(m.student_id)::int AS member_count
    FROM student_groups g
    LEFT JOIN student_group_members m ON m.group_id = g.id
    GROUP BY g.id
    ORDER BY g.created_at DESC
  `);
  
  res.json({ groups: result?.rows || [] });
});

app.post("/admin/groups", requireAdmin, async (req, res) => {
  if (!requireDatabase(res)) {
    return;
  }

  await runAdminAction(res, async () => {
    const { name, description } = req.body;
    const groupName = normalizeAdminText(name, 120);
    const groupDescription = normalizeAdminText(description, 500);
    requireValid(groupName.length > 0, "Group name is required");
    const groupId = createId();
    
    await dbQueryRequired(
      `INSERT INTO student_groups (id, name, description, created_by) VALUES ($1, $2, $3, $4)`,
      [groupId, groupName, groupDescription, getAdminUsername(req)]
    );
    await logAuditAction("group.create", "student_groups", groupId, { name: groupName }, req);
    
    res.json({ ok: true, groupId });
  });
});

app.post("/admin/groups/:id/members", requireAdmin, async (req, res) => {
  if (!requireDatabase(res)) {
    return;
  }

  await runAdminAction(res, async () => {
    const groupId = normalizeAdminId(req.params.id, "group id");
    const { student_id } = req.body;
    const studentId = normalizeAdminId(student_id, "student id");
    
    const result = await dbQueryRequired(
      `INSERT INTO student_group_members (group_id, student_id, added_by)
       VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING`,
      [groupId, studentId, getAdminUsername(req)]
    );
    await logAuditAction("group.member.add", "student_groups", groupId, { student_id: studentId, inserted: result.rowCount }, req);
    
    res.json({ ok: true, inserted: result.rowCount });
  });
});

// Audit Logs
app.get("/admin/audit", requireAdmin, async (req, res) => {
  if (!requireDatabase(res)) {
    return;
  }

  const limit = getReportLimit(req.query.limit, 100);
  const result = await dbQuery(
    `SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT $1`,
    [limit]
  );
  
  res.json({ logs: result?.rows || [] });
});

async function logAuditAction(action, resourceType, resourceId, details, req) {
  if (!db) return;
  
  const auditId = createId();
  await dbQuery(
    `INSERT INTO audit_logs (id, admin_username, action, resource_type, resource_id, details, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)`,
    [
      auditId,
      getAdminUsername(req),
      action,
      resourceType || null,
      resourceId || null,
      details ? JSON.stringify(details) : null,
      req.ip || req.connection?.remoteAddress || null,
      req.get("user-agent") || null
    ]
  );
}

// Active Session Control
app.get("/admin/active-sessions", requireAdmin, (_req, res) => {
  const activeSessions = [];
  for (const [roomCode, room] of rooms.entries()) {
    activeSessions.push({
      roomCode,
      status: room.status,
      playerCount: room.players.size,
      questionIndex: room.questionIndex,
      sessionId: room.sessionId,
      startedAt: room.startedAt
    });
  }
  res.json({ sessions: activeSessions });
});

app.post("/admin/active-sessions/:roomCode/close", requireAdmin, async (req, res) => {
  const roomCode = String(req.params.roomCode || "").trim().toUpperCase();
  const room = rooms.get(roomCode);
  
  if (!room) {
    res.status(404).json({ error: "Room not found" });
    return;
  }
  
  clearRoomTimer(room);
  for (const player of room.players.values()) {
    send(player.ws, {
      type: "room_closed",
      roomCode,
      reason: "Closed by admin"
    });
  }
  send(room.tv, {
    type: "room_closed",
    roomCode,
    reason: "Closed by admin"
  });
  
  void persistSessionStatus(room, "CLOSED");
  await logAuditAction("session.close", "quiz_sessions", room.sessionId || roomCode, { roomCode }, req);
  rooms.delete(roomCode);
  
  res.json({ ok: true, message: "Room closed successfully" });
});

app.post("/admin/active-sessions/:roomCode/kick/:playerId", requireAdmin, async (req, res) => {
  const roomCode = String(req.params.roomCode || "").trim().toUpperCase();
  const playerId = String(req.params.playerId || "");
  const room = rooms.get(roomCode);
  
  if (!room) {
    res.status(404).json({ error: "Room not found" });
    return;
  }
  
  const player = room.players.get(playerId);
  if (!player) {
    res.status(404).json({ error: "Player not found" });
    return;
  }
  
  send(player.ws, {
    type: "kicked",
    reason: "Removed by admin"
  });
  
  if (player.ws) {
    player.ws.close();
  }
  if (player.clientId && room.clientIds) {
    room.clientIds.delete(player.clientId);
  }
  room.players.delete(playerId);
  await logAuditAction("session.player.kick", "session_participants", player.studentId || playerId, { roomCode, playerName: player.name }, req);
  broadcastRoomState(roomCode);
  
  res.json({ ok: true, message: "Player kicked successfully" });
});

function generateRoomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let roomCode = "";

  for (let i = 0; i < 6; i += 1) {
    roomCode += alphabet[Math.floor(Math.random() * alphabet.length)];
  }

  return roomCode;
}

function makeUniqueRoomCode() {
  let roomCode = generateRoomCode();

  while (rooms.has(roomCode)) {
    roomCode = generateRoomCode();
  }

  return roomCode;
}

function clearRoomTimer(room) {
  if (room.timerId) {
    clearTimeout(room.timerId);
    room.timerId = null;
  }
}

function cleanupRoom(roomCode, ws) {
  if (!roomCode) {
    return;
  }

  const room = rooms.get(roomCode);
  if (!room) {
    return;
  }

  if (ws === room.tv) {
    clearRoomTimer(room);
    for (const player of room.players.values()) {
      send(player.ws, {
        type: "room_closed",
        roomCode
      });
    }
    void persistSessionStatus(room, "CLOSED");
    rooms.delete(roomCode);
    return;
  }

  if (ws.meta && ws.meta.playerId) {
    const player = room.players.get(ws.meta.playerId);
    if (player && player.ws === ws) {
      player.ws = null;
      void persistParticipant(room, player);
      broadcastRoomState(roomCode);
    }
  }
}

async function fetchOpenAIQuestion(room) {
  if (!OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  const prompt = `Create one multiple-choice educational quiz question for a Grade ${gameConfig.gradeLevel} student.
Curriculum: ${getCurriculumLabel(gameConfig.curriculum)}
Language mode: ${getLanguageLabel(gameConfig.language)}
Subject: ${getSubjectLabel(gameConfig.subject)}
Difficulty mode: ${gameConfig.difficultyMode}
Question number: ${room.questionIndex + 1} of ${gameConfig.questionsPerRound}
Avoid repeating any of these recent prompts: ${room.history.join(" | ") || "none"}.

Requirements:
- Exactly 4 answer choices labeled A, B, C, and D
- Only one correct answer
- Safe, classroom-appropriate language
- Match the reading level and background knowledge of Grade ${gameConfig.gradeLevel}
- A short explanation under 30 words
- A more detailed elaboration under 90 words
- Keep the question answerable by Grade ${gameConfig.gradeLevel} learners
- ${getCurriculumInstruction(gameConfig.curriculum)}
- ${getLanguageInstruction(gameConfig.language)}
- ${getDifficultyInstruction(gameConfig.difficultyMode)}
- If the subject is English and the curriculum is Cambodia MoEYS, focus on school-level English learning that is realistic for Cambodia classrooms.`;

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      input: prompt,
      text: {
        format: {
          type: "json_schema",
          name: "lyhuor_quiz_question",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["question", "choices", "correctChoice", "shortExplanation", "elaboration", "subject"],
            properties: {
              question: { type: "string" },
              choices: {
                type: "array",
                minItems: 4,
                maxItems: 4,
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["id", "text"],
                  properties: {
                    id: {
                      type: "string",
                      enum: ["A", "B", "C", "D"]
                    },
                    text: { type: "string" }
                  }
                }
              },
              correctChoice: {
                type: "string",
                enum: ["A", "B", "C", "D"]
              },
              shortExplanation: { type: "string" },
              elaboration: { type: "string" },
              subject: {
                type: "string",
                enum: SUPPORTED_SUBJECTS
              }
            }
          }
        }
      },
      store: false
    })
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`OpenAI request failed: ${response.status} ${message}`);
  }

  const data = await response.json();
  const textFromContent = Array.isArray(data.output)
    ? data.output
        .flatMap((item) => Array.isArray(item.content) ? item.content : [])
        .filter((item) => item && typeof item.text === "string")
        .map((item) => item.text)
        .join("\n")
        .trim()
    : "";
  const rawText = typeof data.output_text === "string" && data.output_text.trim()
    ? data.output_text.trim()
    : textFromContent;

  if (!rawText) {
    throw new Error(`OpenAI response did not include JSON text: ${JSON.stringify(data).slice(0, 1200)}`);
  }

  const parsed = JSON.parse(rawText);
  return parsed;
}

function normalizeQuestionBankRow(row) {
  const choices = Array.isArray(row.choices) ? row.choices : JSON.parse(row.choices || "[]");
  return {
    question: row.prompt,
    choices,
    correctChoice: row.correct_choice,
    shortExplanation: row.short_explanation,
    elaboration: row.elaboration,
    subject: row.subject,
    bankQuestionId: row.id
  };
}

async function getQuestionBankQuestion(room) {
  if (!db) {
    return null;
  }

  const result = await dbQuery(
    `SELECT id, prompt, choices, correct_choice, short_explanation, elaboration, subject
     FROM question_bank
     WHERE is_active = TRUE
       AND curriculum = $1
       AND language = $2
       AND subject = $3
       AND grade_level = $4
       AND difficulty_mode = $5
     ORDER BY usage_count ASC, RANDOM()
     LIMIT 10`,
    [gameConfig.curriculum, gameConfig.language, gameConfig.subject, gameConfig.gradeLevel, gameConfig.difficultyMode]
  );
  const rows = result?.rows || [];
  const selected = rows
    .map((row) => {
      try {
        return normalizeQuestionBankRow(row);
      } catch (error) {
        console.error("Invalid question bank row:", error);
        return null;
      }
    })
    .find((question) => question && !room.history.includes(normalizePrompt(question.question)));

  if (!selected) {
    return null;
  }

  await dbQuery(
    `UPDATE question_bank SET usage_count = usage_count + 1, updated_at = NOW() WHERE id = $1`,
    [selected.bankQuestionId]
  );
  return selected;
}

async function generateQuestion(room) {
  function useQuestion(question, source, model = null) {
    room.history.push(normalizePrompt(question.question));
    room.history = room.history.slice(-20);
    return {
      ...question,
      source,
      model
    };
  }

  async function tryOpenAI() {
    if (!OPENAI_API_KEY) {
      return null;
    }

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const question = await fetchOpenAIQuestion(room);
        const normalizedQuestion = normalizePrompt(question.question);

        if (room.history.includes(normalizedQuestion)) {
          throw new Error(`Duplicate question generated: ${question.question}`);
        }

        return useQuestion(question, "openai", OPENAI_MODEL);
      } catch (error) {
        console.error("OpenAI quiz generation failed:", error);
      }
    }

    return null;
  }

  async function tryQuestionBank() {
    const bankQuestion = await getQuestionBankQuestion(room);
    return bankQuestion ? useQuestion(bankQuestion, "question_bank") : null;
  }

  function fallbackQuestion() {
    return useQuestion(getFallbackQuestion(room), "fallback");
  }

  if (gameConfig.questionSource === "fallback_only") {
    return fallbackQuestion();
  }

  if (gameConfig.questionSource === "question_bank_only") {
    return await tryQuestionBank() || fallbackQuestion();
  }

  if (gameConfig.questionSource === "question_bank_openai") {
    return await tryQuestionBank() || await tryOpenAI() || fallbackQuestion();
  }

  if (gameConfig.questionSource === "openai_only") {
    return await tryOpenAI() || fallbackQuestion();
  }

  return await tryOpenAI() || fallbackQuestion();
}

function revealQuestion(roomCode) {
  const room = rooms.get(roomCode);
  if (!room || room.status !== "ANSWERING" || !room.currentQuestion) {
    return;
  }

  clearRoomTimer(room);
  room.revealAnswer = true;
  room.status = "REVIEWING";

  let roundScore = 0;
  for (const player of room.players.values()) {
    const isCorrect = Boolean(player.currentAnswer && player.currentAnswer === room.currentQuestion.correctChoice);
    if (isCorrect) {
      player.score += 1;
      roundScore += 1;
    }
    if (!player.isHost) {
      player.answerHistory = player.answerHistory || [];
      player.answerHistory.push({
        questionIndex: room.questionIndex,
        prompt: room.currentQuestion.question,
        choice: player.currentAnswer || null,
        correctChoice: room.currentQuestion.correctChoice,
        isCorrect,
        shortExplanation: room.currentQuestion.shortExplanation || "",
        elaboration: room.currentQuestion.elaboration || "",
        scoreAfter: player.score
      });
      player.answerHistory = player.answerHistory.slice(-20);
    }
  }
  room.score = roundScore;
  void persistRevealResults(room);
  void persistSessionStatus(room, room.status);

  broadcastRoomState(roomCode);
}

function submitPlayerAnswer(roomCode, playerId, choice) {
  const room = rooms.get(roomCode);
  const player = room && playerId ? room.players.get(playerId) : null;

  if (!room || !player || room.status !== "ANSWERING" || !room.currentQuestion) {
    return;
  }

  if (player.answeredQuestionIndex === room.questionIndex) {
    return;
  }

  const normalizedChoice = String(choice || "").toUpperCase();
  if (!["A", "B", "C", "D"].includes(normalizedChoice)) {
    return;
  }

  player.currentAnswer = normalizedChoice;
  player.answeredQuestionIndex = room.questionIndex;
  player.activeQuestionIndex = room.questionIndex;
  player.answerSubmittedAt = new Date();
  player.answerResponseMs = room.questionStartedAt ? Math.max(0, Date.now() - room.questionStartedAt) : null;
  room.answerCount += 1;
  broadcastRoomState(roomCode);

  const connectedPlayers = [...room.players.values()].filter((entry) =>
    !entry.isHost && Boolean(entry.ws && entry.ws.readyState === WebSocket.OPEN));
  if (connectedPlayers.length > 0 && connectedPlayers.every((entry) => entry.answeredQuestionIndex === room.questionIndex)) {
    revealQuestion(roomCode);
  }
}

async function loadNextQuestion(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) {
    return;
  }

  if (room.questionIndex >= gameConfig.questionsPerRound) {
    room.status = "FINISHED";
    room.currentQuestion = null;
    room.currentQuestionId = null;
    room.questionStartedAt = null;
    room.deadlineAt = null;
    room.revealAnswer = false;
    void persistSessionStatus(room, room.status);
    broadcastRoomState(roomCode);
    return;
  }

  room.status = "LOADING";
  room.currentQuestion = null;
  room.currentQuestionId = null;
  room.questionStartedAt = null;
  room.deadlineAt = null;
  room.revealAnswer = false;
  room.answerCount = 0;
  room.score = 0;
  for (const player of room.players.values()) {
    player.currentAnswer = null;
    player.answeredQuestionIndex = null;
    player.answerSubmittedAt = null;
    player.answerResponseMs = null;
    player.activeQuestionIndex = player.isHost
      ? room.questionIndex
      : (player.ws && player.ws.readyState === WebSocket.OPEN ? room.questionIndex : null);
  }
  void persistSessionStatus(room, room.status);
  broadcastRoomState(roomCode);

  room.currentQuestion = await generateQuestion(room);
  room.currentQuestionId = await persistQuestion(room);
  room.questionStartedAt = Date.now();
  room.deadlineAt = Date.now() + gameConfig.questionTimerSec * 1000;
  room.status = "ANSWERING";
  void persistSessionStatus(room, room.status);
  broadcastRoomState(roomCode);

  room.timerId = setTimeout(() => {
    revealQuestion(roomCode);
  }, gameConfig.questionTimerSec * 1000);
}

async function startGame(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) {
    return;
  }

  clearRoomTimer(room);
  room.status = "LOADING";
  room.questionIndex = 0;
  room.score = 0;
  room.currentQuestion = null;
  room.currentQuestionId = null;
  room.questionStartedAt = null;
  room.revealAnswer = false;
  room.deadlineAt = null;
  room.answerCount = 0;
  room.history = room.history || [];
  for (const player of room.players.values()) {
    player.score = 0;
    player.currentAnswer = null;
    player.answeredQuestionIndex = null;
    player.answerSubmittedAt = null;
    player.answerResponseMs = null;
    player.activeQuestionIndex = null;
  }
  void persistSessionStatus(room, room.status);
  broadcastRoomState(roomCode);

  await loadNextQuestion(roomCode);
}

async function advanceGame(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) {
    return;
  }

  if (room.status === "LOBBY" || room.status === "FINISHED") {
    await startGame(roomCode);
    return;
  }

  if (room.status === "REVIEWING") {
    room.questionIndex += 1;
    await loadNextQuestion(roomCode);
  }
}

async function handleAction(roomCode, action, payload = {}) {
  const room = rooms.get(roomCode);
  if (!room) {
    return;
  }

  if (action === "start" || action === "next") {
    if (room.status === "ANSWERING") {
      revealQuestion(roomCode);
      return;
    }

    await advanceGame(roomCode);
    return;
  }

  if (action.startsWith("answer_")) {
    if (payload.fromTv) {
      submitPlayerAnswer(roomCode, room.hostPlayerId, action.split("_")[1].toUpperCase());
      return;
    }

    submitPlayerAnswer(roomCode, payload.playerId, action.split("_")[1].toUpperCase());
    return;
  }

  if (action === "answer" && payload.choice) {
    if (payload.fromTv) {
      submitPlayerAnswer(roomCode, room.hostPlayerId, String(payload.choice).toUpperCase());
      return;
    }

    submitPlayerAnswer(roomCode, payload.playerId, String(payload.choice).toUpperCase());
  }
}

wss.on("connection", (ws) => {
  ws.meta = {
    roomCode: null,
    role: null,
    playerId: null
  };

  send(ws, { type: "connected" });

  ws.on("message", async (rawMessage) => {
    try {
      let data;

      try {
        data = JSON.parse(rawMessage.toString());
      } catch (_error) {
        send(ws, {
          type: "error",
          message: "Invalid JSON payload"
        });
        return;
      }

      if (data.type === "create_room") {
        const roomCode = makeUniqueRoomCode();
        const hostPlayerId = createPlayerId();
        rooms.set(roomCode, {
          roomCode,
          tv: ws,
          players: new Map(),
          clientIds: new Map(),
          sessionId: null,
          hostPlayerId,
          playerSequence: 1,
          status: "LOBBY",
          questionIndex: 0,
          score: 0,
          currentQuestion: null,
          currentQuestionId: null,
          questionStartedAt: null,
          revealAnswer: false,
          deadlineAt: null,
          timerId: null,
          history: [],
          answerCount: 0
        });

        const room = rooms.get(roomCode);
        room.players.set(hostPlayerId, {
          playerId: hostPlayerId,
          name: "TV Remote",
          clientId: "tv-remote",
          ws: null,
          isHost: true,
          score: 0,
          answerHistory: [],
          currentAnswer: null,
          answeredQuestionIndex: null,
          answerSubmittedAt: null,
          answerResponseMs: null,
          activeQuestionIndex: null
        });
        room.sessionId = await persistSessionCreated(room);
        await persistParticipant(room, room.players.get(hostPlayerId));

        ws.meta.roomCode = roomCode;
        ws.meta.role = "tv";

        send(ws, {
          type: "room_created",
          roomCode,
          state: buildRoomState(roomCode)
        });
        return;
      }

      if (data.type === "join_room") {
        const roomCode = String(data.roomCode || "").trim().toUpperCase();
        const room = rooms.get(roomCode);
        const clientId = normalizeClientId(data.clientId);

        if (!room) {
          send(ws, {
            type: "join_error",
            message: "Room not found"
          });
          return;
        }

        if (ws.meta.playerId && ws.meta.roomCode === roomCode && room.players.has(ws.meta.playerId)) {
          const existingPlayer = room.players.get(ws.meta.playerId);
          if (existingPlayer) {
            existingPlayer.studentId = existingPlayer.studentId || await upsertStudent(existingPlayer.clientId || `${room.roomCode}:${existingPlayer.playerId}`, existingPlayer.name);
            const activeBlock = await getActiveStudentBlock(existingPlayer.studentId);
            if (activeBlock) {
              send(ws, {
                type: "join_error",
                message: activeBlock.reason || "This student is blocked by the teacher."
              });
              return;
            }
            existingPlayer.ws = ws;
            if (room.status === "ANSWERING") {
              existingPlayer.activeQuestionIndex = room.questionIndex;
            }
            await persistParticipant(room, existingPlayer);
            send(ws, {
              type: "joined_room",
              roomCode,
              playerId: existingPlayer.playerId,
              playerName: existingPlayer.name,
              state: buildRoomState(roomCode, ws)
            });
            broadcastRoomState(roomCode);
            return;
          }
        }

        if (clientId && room.clientIds && room.clientIds.has(clientId)) {
          const existingPlayerId = room.clientIds.get(clientId);
          const existingPlayer = existingPlayerId ? room.players.get(existingPlayerId) : null;

          if (existingPlayer) {
            const requestedName = String(data.playerName || "").trim();
            if (requestedName) {
              existingPlayer.name = requestedName.slice(0, 24);
            }
            existingPlayer.studentId = existingPlayer.studentId || await upsertStudent(existingPlayer.clientId || `${room.roomCode}:${existingPlayer.playerId}`, existingPlayer.name);
            const activeBlock = await getActiveStudentBlock(existingPlayer.studentId);
            if (activeBlock) {
              send(ws, {
                type: "join_error",
                message: activeBlock.reason || "This student is blocked by the teacher."
              });
              return;
            }
            existingPlayer.ws = ws;
            if (room.status === "ANSWERING") {
              existingPlayer.activeQuestionIndex = room.questionIndex;
            }
            ws.meta.roomCode = roomCode;
            ws.meta.role = "player";
            ws.meta.playerId = existingPlayer.playerId;
            await persistParticipant(room, existingPlayer);

            send(ws, {
              type: "joined_room",
              roomCode,
              playerId: existingPlayer.playerId,
              playerName: existingPlayer.name,
              state: buildRoomState(roomCode, ws)
            });
            broadcastRoomState(roomCode);
            return;
          }

          room.clientIds.delete(clientId);
        }

        if (ws.meta.playerId && ws.meta.roomCode && ws.meta.roomCode !== roomCode) {
          send(ws, {
            type: "join_error",
            message: "This phone is already joined to another room. Refresh to switch rooms."
          });
          return;
        }

        if (room.players.size >= MAX_ROOM_PLAYERS) {
          send(ws, {
            type: "join_error",
            message: "Room is full. Please use another room."
          });
          return;
        }

        const playerId = createPlayerId();
        const playerName = getOrCreatePlayerName(room, data.playerName);
        const studentId = await upsertStudent(clientId || `${room.roomCode}:${playerId}`, playerName);
        const activeBlock = await getActiveStudentBlock(studentId);
        if (activeBlock) {
          send(ws, {
            type: "join_error",
            message: activeBlock.reason || "This student is blocked by the teacher."
          });
          return;
        }
        room.players.set(playerId, {
          playerId,
          name: playerName,
          clientId: clientId || null,
          studentId,
          ws,
          score: 0,
          answerHistory: [],
          currentAnswer: null,
          answeredQuestionIndex: null,
          answerSubmittedAt: null,
          answerResponseMs: null,
          activeQuestionIndex: room.status === "ANSWERING" ? room.questionIndex : null
        });
        if (clientId && room.clientIds) {
          room.clientIds.set(clientId, playerId);
        }
        await persistParticipant(room, room.players.get(playerId));

        ws.meta.roomCode = roomCode;
        ws.meta.role = "player";
        ws.meta.playerId = playerId;

        send(ws, {
          type: "joined_room",
          roomCode,
          playerId,
          playerName,
          state: buildRoomState(roomCode, ws)
        });

        broadcastRoomState(roomCode);
        return;
      }

      if (data.type === "control") {
        const roomCode = String(data.roomCode || ws.meta.roomCode || "").trim().toUpperCase();
        const room = rooms.get(roomCode);

        if (!room || !ws.meta.playerId || !room.players.has(ws.meta.playerId)) {
          send(ws, {
            type: "error",
            message: "You are not joined to an active room"
          });
          return;
        }

        await handleAction(roomCode, data.action, {
          ...data,
          playerId: ws.meta.playerId
        });
        return;
      }

      if (data.type === "tv_action") {
        const roomCode = String(ws.meta.roomCode || "").trim().toUpperCase();
        const room = rooms.get(roomCode);

        if (!room || ws !== room.tv) {
          send(ws, {
            type: "error",
            message: "TV room is not active"
          });
          return;
        }

        await handleAction(roomCode, data.action, {
          ...data,
          fromTv: true
        });
      }
    } catch (error) {
      console.error("WebSocket message handling failed:", error);
      send(ws, {
        type: "error",
        message: "Internal server error"
      });
    }
  });

  ws.on("close", () => {
    cleanupRoom(ws.meta.roomCode, ws);
  });
});

process.on("uncaughtException", (error) => {
  console.error("Uncaught exception:", error);
});

process.on("unhandledRejection", (error) => {
  console.error("Unhandled rejection:", error);
});

async function startServer() {
  const databaseReady = await initDatabase();
  const dbConfig = await loadDbConfig();
  if (dbConfig) {
    Object.assign(gameConfig, sanitizeConfig(dbConfig));
  } else if (databaseReady) {
    await persistDbConfig(gameConfig);
  }

  server.listen(PORT, "0.0.0.0", () => {
    if (!ADMIN_TOKEN) {
      console.warn("ADMIN_TOKEN is not configured. Admin endpoints will reject all requests.");
    }

    if (!OPENAI_API_KEY) {
      console.warn("OPENAI_API_KEY is not configured. Gateway will use fallback questions only.");
    }

    if (!db) {
      console.warn("DATABASE_URL is not configured. Student progress will be in-memory only.");
    }

    console.log(`Gateway listening on port ${PORT}`);
  });
}

startServer().catch((error) => {
  console.error("Gateway startup failed:", error);
  if (!ADMIN_TOKEN) {
    console.warn("ADMIN_TOKEN is not configured. Admin endpoints will reject all requests.");
  }
});
