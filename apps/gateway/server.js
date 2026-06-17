const fs = require("fs");
const path = require("path");
const express = require("express");
const http = require("http");
const WebSocket = require("ws");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = Number(process.env.PORT || 3000);
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5.4-mini";
const CONFIG_PATH = process.env.CONFIG_PATH || path.join(__dirname, "data", "game-config.json");
const APP_VERSION = process.env.APP_VERSION || "1.0.0";
const startedAt = new Date().toISOString();
const rooms = new Map();
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
const SUPPORTED_QUESTION_SOURCES = ["openai_fallback", "fallback_only"];
const MIN_GRADE_LEVEL = 2;
const MAX_GRADE_LEVEL = 12;

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

app.use(express.json());
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Admin-Token");
  res.setHeader("Access-Control-Allow-Methods", "GET, PUT, OPTIONS");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  next();
});

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

function isAuthorized(req) {
  if (!ADMIN_TOKEN) {
    return false;
  }

  const headerToken = req.get("authorization")?.replace(/^Bearer\s+/i, "");
  const fallbackToken = req.get("x-admin-token");
  return (headerToken || fallbackToken) === ADMIN_TOKEN;
}

function requireAdmin(req, res, next) {
  if (!isAuthorized(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  next();
}

function sanitizeConfig(input) {
  const nextConfig = {
    brandTitle: String(input.brandTitle ?? defaultGameConfig.brandTitle).trim() || defaultGameConfig.brandTitle,
    brandCaption: String(input.brandCaption ?? defaultGameConfig.brandCaption).trim() || defaultGameConfig.brandCaption,
    curriculum: String(input.curriculum ?? defaultGameConfig.curriculum).trim().toLowerCase() || defaultGameConfig.curriculum,
    language: String(input.language ?? defaultGameConfig.language).trim().toLowerCase() || defaultGameConfig.language,
    subject: String(input.subject ?? defaultGameConfig.subject).trim().toLowerCase() || defaultGameConfig.subject,
    gradeLevel: Number(input.gradeLevel ?? defaultGameConfig.gradeLevel),
    difficultyMode: String(input.difficultyMode ?? defaultGameConfig.difficultyMode).trim().toLowerCase() || defaultGameConfig.difficultyMode,
    questionSource: String(input.questionSource ?? defaultGameConfig.questionSource).trim().toLowerCase() || defaultGameConfig.questionSource,
    questionsPerRound: Number(input.questionsPerRound ?? defaultGameConfig.questionsPerRound),
    questionTimerSec: Number(input.questionTimerSec ?? defaultGameConfig.questionTimerSec)
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

function send(ws, payload) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function createPlayerId() {
  return `P${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
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
          answered: viewerPlayer.answeredQuestionIndex === room.questionIndex && room.status === "ANSWERING"
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

app.put("/admin/config", requireAdmin, (req, res) => {
  const nextConfig = sanitizeConfig(req.body || {});
  Object.assign(gameConfig, nextConfig);
  const persisted = persistConfig(gameConfig);
  broadcastConfig();
  res.json({
    ok: true,
    persisted,
    config: gameConfig
  });
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
    rooms.delete(roomCode);
    return;
  }

  if (ws.meta && ws.meta.playerId) {
    const player = room.players.get(ws.meta.playerId);
    if (player && player.ws === ws) {
      player.ws = null;
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

async function generateQuestion(room) {
  if (gameConfig.questionSource === "fallback_only") {
    const fallbackOnlyQuestion = getFallbackQuestion(room);
    room.history.push(normalizePrompt(fallbackOnlyQuestion.question));
    room.history = room.history.slice(-20);
    return fallbackOnlyQuestion;
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const question = await fetchOpenAIQuestion(room);
      const normalizedQuestion = normalizePrompt(question.question);

      if (room.history.includes(normalizedQuestion)) {
        throw new Error(`Duplicate question generated: ${question.question}`);
      }

      room.history.push(normalizedQuestion);
      room.history = room.history.slice(-20);
      return question;
    } catch (error) {
      console.error("OpenAI quiz generation failed:", error);

      if (attempt === 2) {
        const fallback = getFallbackQuestion(room);
        const normalizedFallback = normalizePrompt(fallback.question);
        room.history.push(normalizedFallback);
        room.history = room.history.slice(-20);
        return fallback;
      }
    }
  }
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
    if (player.currentAnswer && player.currentAnswer === room.currentQuestion.correctChoice) {
      player.score += 1;
      roundScore += 1;
    }
  }
  room.score = roundScore;

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

  player.currentAnswer = choice;
  player.answeredQuestionIndex = room.questionIndex;
  room.answerCount += 1;
  broadcastRoomState(roomCode);

  const connectedPlayers = [...room.players.values()].filter((entry) => entry.isHost
    ? Boolean(room.tv && room.tv.readyState === WebSocket.OPEN)
    : Boolean(entry.ws && entry.ws.readyState === WebSocket.OPEN));
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
    room.deadlineAt = null;
    room.revealAnswer = false;
    broadcastRoomState(roomCode);
    return;
  }

  room.status = "LOADING";
  room.currentQuestion = null;
  room.deadlineAt = null;
  room.revealAnswer = false;
  room.answerCount = 0;
  room.score = 0;
  for (const player of room.players.values()) {
    player.currentAnswer = null;
    player.answeredQuestionIndex = null;
  }
  broadcastRoomState(roomCode);

  room.currentQuestion = await generateQuestion(room);
  room.deadlineAt = Date.now() + gameConfig.questionTimerSec * 1000;
  room.status = "ANSWERING";
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
  room.revealAnswer = false;
  room.deadlineAt = null;
  room.answerCount = 0;
  room.history = room.history || [];
  for (const player of room.players.values()) {
    player.score = 0;
    player.currentAnswer = null;
    player.answeredQuestionIndex = null;
  }
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
          tv: ws,
          players: new Map(),
          hostPlayerId,
          playerSequence: 1,
          status: "LOBBY",
          questionIndex: 0,
          score: 0,
          currentQuestion: null,
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
          ws: null,
          isHost: true,
          score: 0,
          currentAnswer: null,
          answeredQuestionIndex: null
        });

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

        if (!room) {
          send(ws, {
            type: "join_error",
            message: "Room not found"
          });
          return;
        }

        const playerId = createPlayerId();
        const playerName = getOrCreatePlayerName(room, data.playerName);
        room.players.set(playerId, {
          playerId,
          name: playerName,
          ws,
          score: 0,
          currentAnswer: null,
          answeredQuestionIndex: null
        });

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

server.listen(PORT, "0.0.0.0", () => {
  if (!ADMIN_TOKEN) {
    console.warn("ADMIN_TOKEN is not configured. Admin endpoints will reject all requests.");
  }

  if (!OPENAI_API_KEY) {
    console.warn("OPENAI_API_KEY is not configured. Gateway will use fallback questions only.");
  }

  console.log(`Gateway listening on port ${PORT}`);
});
