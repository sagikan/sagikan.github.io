const TECH_WORDS = [
  "JavaScript", "TypeScript", "Python", "Java", "Go", "C#", "C++", "SQL", "Node.js", "React", "Angular", "Vue",
  "PostgreSQL", "MySQL", "MongoDB", "Redis", "Kafka", "Docker", "Kubernetes", "AWS", "GCP", "Azure",
  "Terraform", "GraphQL", "REST", "CI/CD", "Linux", "Git"
];

// With NODE_ENV=development, paid and non-essential outside calls (Claude, JSearch, posting checks,
// emails) are swapped for free local stand-ins. USE_REAL_APIS=true turns the real ones back on.
// Read on each use, since .env may load after this module does.
function isOffline() {
  return process.env.NODE_ENV === "development" && process.env.USE_REAL_APIS !== "true";
}

function sampleResume() {
  return {
    cv: {
      name: "Dana Levi",
      headline: "Software Engineer",
      email: "dana.levi@example.com",
      phone: "+972 50-000-0000",
      location: "Tel Aviv, Israel",
      links: [{ label: "GitHub", url: "https://github.com/example" }],
      summary:
        "Software engineer with hands-on experience building backend services and web apps in Node.js and Python.\n" +
        "Seeking a Backend Engineer position.",
      experience: [
        {
          title: "Software Engineer",
          company: "Example Labs",
          location: "Tel Aviv, Israel",
          start: "Jan 2024",
          end: "Present",
          bullets: [
            "Built REST APIs in Node.js and PostgreSQL serving the company's main dashboard",
            "Moved background jobs to a queue, cutting page load times for heavy reports",
            "Wrote integration tests and set up CI with GitHub Actions"
          ]
        },
        {
          title: "Junior Developer",
          company: "Sample Systems",
          location: "Haifa, Israel",
          start: "Jun 2022",
          end: "Dec 2023",
          bullets: [
            "Maintained internal tools in Python and Flask",
            "Built React pages for the support team's ticket view"
          ]
        }
      ],
      projects: [
        {
          name: "Email Service | Node.js, MongoDB",
          start: "2023",
          end: "2023",
          link: "",
          bullets: ["Built a JWT-secured REST API with search and pagination", "Designed the inbox UI across web and Android"]
        },
        {
          name: "Weather Bot | Python",
          start: "2022",
          end: "2022",
          link: "",
          bullets: ["Built a Telegram bot that sends personalized daily forecasts"]
        }
      ],
      education: [
        {
          degree: "B.Sc.",
          major: "Computer Science",
          school: "Example University",
          location: "Israel",
          start: "2019",
          end: "2022",
          gpa: "88"
        }
      ],
      skills: [
        { category: "Languages", items: ["JavaScript", "TypeScript", "Python", "SQL"] },
        { category: "Tools", items: ["Node.js", "React", "PostgreSQL", "Docker", "Git"] }
      ],
      extras: [{ title: "Languages", items: ["Hebrew (native)", "English (fluent)"] }]
    },
    preferences: {
      roles: ["Backend Engineer", "Full-stack Developer", "Software Engineer"],
      locations: ["Tel Aviv, Israel"],
      workplace_models: ["Hybrid", "Remote"],
      seniority: "Junior"
    }
  };
}

function mentions(text, word) {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^A-Za-z0-9])${escaped}($|[^A-Za-z0-9])`, "i").test(text);
}

function scores(cv, candidates) {
  const skills = [...new Set(cv.skills.flatMap((group) => group.items))];

  return candidates.map((posting) => {
    const text = `${posting.title} ${posting.description || ""}`;
    const have = skills.filter((skill) => mentions(text, skill)).slice(0, 8);
    const missing = TECH_WORDS
      .filter((word) => mentions(text, word) && !skills.some((skill) => skill.toLowerCase() === word.toLowerCase()))
      .slice(0, 6);
    const score = Math.max(15, Math.min(95, 45 + have.length * 9 - missing.length * 6));
    return { id: String(posting.id), score, have, missing };
  });
}

function tailoring(base, job) {
  const reworkBullets = (bullets) => bullets
    .slice(0, 2)
    .reverse()
    .map((bullet, index) => ({
      source_id: bullet.id,
      text: index === 0 ? `${bullet.text} (tailored for ${job.company || "this job"})` : bullet.text
    }));
  const skills = base.skills.flatMap((group) => group.items);

  return {
    headline: job.position ? job.position.split(/\s[-–(,]/)[0].trim() : base.headline,
    summary: base.summary,
    experience: base.experience.map((entry) => ({ id: entry.id, bullets: reworkBullets(entry.bullets) })),
    projects: [...base.projects].reverse().slice(0, 3).map((entry) => ({ id: entry.id, bullets: reworkBullets(entry.bullets) })),
    skills: [...base.skills].reverse(),
    gaps: ["Kubernetes", "GraphQL", "AWS"].filter((gap) => !skills.some((skill) => skill.toLowerCase() === gap.toLowerCase()))
  };
}

function classify({ from, subject, body }) {
  const text = `${subject}\n${body}`;
  const has = (pattern) => pattern.test(text);
  const sender = /^\s*"?([^"<]+?)"?\s*</.exec(from || "")?.[1]?.trim() || "";
  let event = "other";

  if (has(/not (?:be )?moving forward|unfortunately|other candidates|regret to inform|position (?:has been )?(?:filled|closed)/i)) {
    event = "rejection";
  } else if (has(/job offer|pleased to offer|offer letter/i)) {
    event = "offer";
  } else if (has(/interview|schedule a (?:call|time)|your availability|phone screen/i)) {
    event = "interview";
  } else if (has(/assessment|assignment|coding (?:test|challenge)|home ?task/i)) {
    event = "assessment";
  } else if (has(/viewed your application/i)) {
    event = "viewed";
  } else if (has(/received your application|thank you for (?:applying|your application)|application (?:was )?(?:received|submitted)/i)) {
    event = "received";
  }

  return {
    jobRelated: event !== "other" || has(/\bapplication\b|\bposition\b|\brole\b/i),
    event,
    company: sender.slice(0, 200),
    position: "",
    confidence: 0.6
  };
}

module.exports = {
  get offline() {
    return isOffline();
  },
  sampleResume,
  scores,
  tailoring,
  classify
};
