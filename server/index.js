const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const cors = require("cors");
const session = require("express-session");
const bodyParser = require("body-parser");
const fs = require("fs");
const path = require("path");

// File paths for persistent storage
const dataDir = path.join(__dirname, "data");
const complaintsFile = path.join(dataDir, "complaints.json");
const feedbackFile = path.join(dataDir, "feedback.json");

// Create data directory if it doesn't exist
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Load data from files or initialize empty
let complaints = [];
let messFeedbackCounts = { Good: 0, Average: 0, Poor: 0 };
let messFeedbackEntries = [];
let notices = [];
let activeSessionsMap = new Map(); // Track active sessions

// Room database for RMI simulation
const roomsDatabase = {
  A101: {
    roomNo: "A101",
    occupantNames: ["John Doe", "Jane Smith"],
    wardenContact: {
      name: "Dr. Sarah Johnson",
      phone: "+1-555-0101",
      email: "sarah.johnson@hostel.edu",
    },
  },
  A102: {
    roomNo: "A102",
    occupantNames: ["Mike Wilson", "Tom Brown"],
    wardenContact: {
      name: "Dr. Sarah Johnson",
      phone: "+1-555-0101",
      email: "sarah.johnson@hostel.edu",
    },
  },
  B201: {
    roomNo: "B201",
    occupantNames: ["Alice Cooper"],
    wardenContact: {
      name: "Dr. Robert Lee",
      phone: "+1-555-0202",
      email: "robert.lee@hostel.edu",
    },
  },
  B202: {
    roomNo: "B202",
    occupantNames: ["Bob Taylor", "Carol White"],
    wardenContact: {
      name: "Dr. Robert Lee",
      phone: "+1-555-0202",
      email: "robert.lee@hostel.edu",
    },
  },
};

try {
  if (fs.existsSync(complaintsFile)) {
    complaints = JSON.parse(fs.readFileSync(complaintsFile, "utf8"));
    console.log("✓ Loaded complaints from file:", complaints.length);
  }
} catch (err) {
  console.error("Error loading complaints file:", err);
  complaints = [];
}

try {
  if (fs.existsSync(feedbackFile)) {
    const data = JSON.parse(fs.readFileSync(feedbackFile, "utf8"));
    messFeedbackCounts = data.counts || { Good: 0, Average: 0, Poor: 0 };
    messFeedbackEntries = data.entries || [];
    console.log("✓ Loaded feedback from file:", messFeedbackEntries.length);
    // Ensure counts are numbers
    messFeedbackCounts.Good = messFeedbackCounts.Good || 0;
    messFeedbackCounts.Average = messFeedbackCounts.Average || 0;
    messFeedbackCounts.Poor = messFeedbackCounts.Poor || 0;
  }
} catch (err) {
  console.error("Error loading feedback file:", err);
  messFeedbackEntries = [];
  messFeedbackCounts = { Good: 0, Average: 0, Poor: 0 };
}

const dailyFeedbackMap = new Map();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "http://localhost:3000",
    credentials: true,
  },
});

const PORT = 5000;

/* ---------------- MIDDLEWARE ---------------- */
app.use(
  cors({
    origin: "http://localhost:3000",
    credentials: true,
  })
);

app.use(bodyParser.json());

/* ---------------- SYSTEM HEALTH ENDPOINT ---------------- */
app.get("/api/health", (req, res) => {
  // Clean up old sessions (older than 24 hours)
  const now = Date.now();
  for (const [sessionId, sessionData] of activeSessionsMap.entries()) {
    if (now - sessionData.lastAccess > 24 * 60 * 60 * 1000) {
      activeSessionsMap.delete(sessionId);
    }
  }

  const totalFeedback =
    (messFeedbackCounts.Good || 0) +
    (messFeedbackCounts.Average || 0) +
    (messFeedbackCounts.Poor || 0);

  res.json({
    modules: {
      socket: {
        status: io.engine.clientsCount > 0 ? "online" : "offline",
        connections: io.engine.clientsCount || 0,
      },
      rest: {
        status: "online",
      },
      sharedMemory: {
        status: "online",
        totalFeedback: totalFeedback,
      },
      rmi: {
        status: "online",
        roomsCount: Object.keys(roomsDatabase).length,
      },
      p2p: {
        status: io.engine.clientsCount > 0 ? "online" : "offline",
      },
      session: {
        status: activeSessionsMap.size > 0 ? "online" : "offline",
        activeSessions: activeSessionsMap.size,
      },
    },
    timestamp: new Date().toISOString(),
  });
});

app.use(
  session({
    secret: "hostel-system-secret-key-2024",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: false,
      sameSite: "lax",
      maxAge: 24 * 60 * 60 * 1000,
    },
  })
);

// Track active sessions
app.use((req, res, next) => {
  if (req.session && req.session.userId) {
    activeSessionsMap.set(req.sessionID, {
      userId: req.session.userId,
      role: req.session.role,
      lastAccess: Date.now(),
    });
  }
  next();
});

/* Helper function to save complaints to file */
function saveComplaints() {
  try {
    fs.writeFileSync(complaintsFile, JSON.stringify(complaints, null, 2));
  } catch (err) {
    console.error("Error saving complaints:", err);
  }
}

/* Helper function to save feedback to file */
function saveFeedback() {
  try {
    fs.writeFileSync(
      feedbackFile,
      JSON.stringify(
        { counts: messFeedbackCounts, entries: messFeedbackEntries },
        null,
        2
      )
    );
  } catch (err) {
    console.error("Error saving feedback:", err);
  }
}

/* ---------------- USERS ---------------- */
const users = {
  student1: {
    username: "student1",
    password: "student123",
    role: "student",
    name: "Student One",
  },
  student2: {
    username: "student2",
    password: "student123",
    role: "student",
    name: "Student Two",
  },
  student3: {
    username: "student3",
    password: "student123",
    role: "student",
    name: "Student Three",
  },
  student4: {
    username: "student4",
    password: "student123",
    role: "student",
    name: "Student Four",
  },
  student5: {
    username: "student5",
    password: "student123",
    role: "student",
    name: "Student Five",
  },
  admin: {
    username: "admin",
    password: "admin123",
    role: "admin",
    name: "Admin",
  },
};

/* ---------------- AUTH ---------------- */
app.post("/api/login", (req, res) => {
  const { username, password, role } = req.body;
  
  console.log("Login attempt:", { username, role });
  
  const user = users[username];

  if (!user) {
    console.log("User not found:", username);
    return res
      .status(401)
      .json({ success: false, message: "Invalid credentials" });
  }

  if (user.password !== password) {
    console.log("Password mismatch for:", username);
    return res
      .status(401)
      .json({ success: false, message: "Invalid credentials" });
  }

  if (user.role !== role) {
    console.log("Role mismatch for:", username, "Expected:", user.role, "Got:", role);
    return res
      .status(401)
      .json({ success: false, message: "Invalid credentials" });
  }

  req.session.userId = username;
  req.session.role = role;
  req.session.name = user.name;

  // Track session
  activeSessionsMap.set(req.sessionID, {
    userId: username,
    role: role,
    lastAccess: Date.now(),
  });

  console.log("Login successful for:", username);
  res.json({
    success: true,
    user: {
      username,
      role,
      name: user.name,
    },
  });
});

app.post("/api/logout", (req, res) => {
  if (req.sessionID) {
    activeSessionsMap.delete(req.sessionID);
  }
  req.session.destroy(() => {
    res.json({ success: true });
  });
});

/* 🔑 SESSION RESTORE (FIX REFRESH ISSUE) */
app.get("/api/me", (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ success: false });
  }

  res.json({
    success: true,
    user: {
      username: req.session.userId,
      role: req.session.role,
      name: req.session.name,
    },
  });
});

/* ---------------- SOCKET: COMPLAINTS ---------------- */
io.on("connection", (socket) => {
  console.log("New client connected:", socket.id);

  socket.on("submitComplaint", (data) => {
    // Find max ID to avoid duplicates
    const maxId = complaints.length > 0 
      ? Math.max(...complaints.map(c => Number(c.id) || 0))
      : 0;
    
    const complaint = {
      id: maxId + 1,
      userId: data.userId,
      roomNumber: data.roomNumber,
      category: data.category,
      description: data.description,
      status: "Pending",
      date: new Date().toISOString(),
    };

    complaints.push(complaint);
    saveComplaints(); // Save to file

    socket.emit("complaintAcknowledgment", {
      success: true,
      message: "Complaint submitted successfully",
    });

    console.log("New complaint submitted:", complaint);
    // Broadcast to all clients including admin
    io.emit("newComplaint", complaint);
  });

  socket.on("getComplaints", () => {
    socket.emit("complaintsList", complaints);
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
  });
});

/* ---------------- COMPLAINT APIs ---------------- */
app.get("/api/complaints", (req, res) => {
  res.json({ success: true, complaints });
});

app.get("/api/complaints/stats", (req, res) => {
  res.json({
    success: true,
    stats: {
      total: complaints.length,
      pending: complaints.filter((c) => c.status === "Pending").length,
      resolved: complaints.filter((c) => c.status === "Resolved").length,
    },
  });
});

app.put("/api/complaints/:id", (req, res) => {
  const complaint = complaints.find(
    (c) => Number(c.id) === Number(req.params.id)
  );

  if (!complaint) {
    return res.status(404).json({ success: false });
  }

  complaint.status = req.body.status;
  complaint.updatedAt = new Date().toISOString();

  saveComplaints(); // Save to file
  io.emit("complaintUpdated", complaint);
  res.json({ success: true, complaint });
});

/* ---------------- MESS FEEDBACK (FIXED) ---------------- */
app.post("/api/mess-feedback", (req, res) => {
  const { feedback } = req.body;
  const userId = req.session.userId;

  if (!userId) {
    return res.status(401).json({ success: false });
  }

  const today = new Date().toISOString().split("T")[0];
  const key = `${userId}_${today}`;
  const count = dailyFeedbackMap.get(key) || 0;

  if (count >= 3) {
    return res.status(429).json({
      success: false,
      message: "You can submit only 3 feedbacks per day",
    });
  }

  dailyFeedbackMap.set(key, count + 1);

  messFeedbackEntries.push({
    userId,
    type: feedback,
    date: new Date().toISOString(),
  });

  messFeedbackCounts[feedback]++;
  saveFeedback(); // Save to file

  console.log(
    "Feedback submitted:",
    feedback,
    "Total counts:",
    messFeedbackCounts
  );
  io.emit("feedbackUpdate", { counts: messFeedbackCounts });

  res.json({
    success: true,
    counts: messFeedbackCounts,
    remaining: 3 - (count + 1),
  });
});

app.get("/api/mess-feedback/stats", (req, res) => {
  res.json({
    success: true,
    stats: {
      good: messFeedbackCounts.Good || 0,
      average: messFeedbackCounts.Average || 0,
      poor: messFeedbackCounts.Poor || 0,
      total:
        (messFeedbackCounts.Good || 0) +
        (messFeedbackCounts.Average || 0) +
        (messFeedbackCounts.Poor || 0),
    },
  });
});

app.get("/api/mess-feedback/live", (req, res) => {
  res.json({
    counts: {
      Good: messFeedbackCounts.Good || 0,
      Average: messFeedbackCounts.Average || 0,
      Poor: messFeedbackCounts.Poor || 0,
    },
  });
});

/* ---------------- NOTICES API ---------------- */
app.get("/api/notices", (req, res) => {
  res.json(notices);
});

app.post("/api/notices", (req, res) => {
  const { title, message } = req.body;

  if (!title || !message) {
    return res.status(400).json({ success: false, message: "Title and message are required" });
  }

  const notice = {
    id: notices.length + 1,
    title,
    message,
    createdAt: new Date().toISOString(),
  };

  notices.push(notice);
  
  // Broadcast new notice to all connected clients
  io.emit("newNotice", notice);
  console.log("New notice created and broadcast:", notice);
  
  res.json({ success: true, notice });
});

/* ---------------- ROOMS API (RMI Simulation) ---------------- */
app.get("/api/rooms/search", (req, res) => {
  const { roomNo } = req.query;

  if (!roomNo) {
    return res.status(400).json({ success: false, message: "Room number is required" });
  }

  const room = roomsDatabase[roomNo];

  if (!room) {
    return res.json({ success: false, message: "Room not found" });
  }

  res.json({
    success: true,
    room: {
      roomNo: room.roomNo,
      occupantNames: room.occupantNames,
      wardenContact: room.wardenContact,
    },
  });
});

/* ---------------- START ---------------- */
server.listen(PORT, () =>
  console.log(`🚀 Server running on http://localhost:${PORT}`)
);
