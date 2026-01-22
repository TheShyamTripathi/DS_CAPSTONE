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

// Module 4: P2P - Peer registry and file storage
const peerRegistry = new Map(); // Map<socketId, {peerId, username, files: []}>
const peerFiles = new Map(); // Map<fileId, {id, name, size, data, ownerPeerId}>

// Module 5: Shared Memory - Synchronization lock
let feedbackLock = false; // Simple mutex for feedback updates

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
    origin: ["http://localhost:3000", "http://localhost:3001"],
    credentials: true,
  },
});

const PORT = 5000;

/* ---------------- MIDDLEWARE ---------------- */
app.use(
  cors({
    origin: ["http://localhost:3000", "http://localhost:3001"],
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

  // ---------------- P2P MODULE - PEER REGISTRATION ----------------
  socket.on("registerPeer", (data) => {
    const { username } = data;
    if (!username) {
      socket.emit("peerRegistrationError", { message: "Username required" });
      return;
    }

    const peerInfo = {
      peerId: socket.id,
      username: username,
      files: [],
      registeredAt: Date.now(),
    };

    peerRegistry.set(socket.id, peerInfo);
    console.log(`Peer registered: ${username} (${socket.id})`);

    // Notify all peers about new peer
    broadcastPeerList();
  });

  // ---------------- P2P MODULE - GET PEER LIST ----------------
  socket.on("getPeerList", () => {
    const peerList = Array.from(peerRegistry.values()).map((peer) => ({
      peerId: peer.peerId,
      username: peer.username,
      fileCount: peer.files.length,
    }));
    socket.emit("peerList", peerList);
  });

  // ---------------- P2P MODULE - UPLOAD FILE ----------------
  socket.on("uploadFile", (data) => {
    const { fileName, fileSize, fileData } = data;
    const peerInfo = peerRegistry.get(socket.id);

    if (!peerInfo) {
      socket.emit("uploadError", { message: "Peer not registered. Please refresh the page." });
      return;
    }

    if (!fileName || !fileData) {
      socket.emit("uploadError", { message: "File data required" });
      return;
    }

    // Limit file size to 10MB for demo purposes
    const maxSize = 10 * 1024 * 1024; // 10MB
    if (fileSize > maxSize) {
      socket.emit("uploadError", { message: "File size exceeds 10MB limit" });
      return;
    }

    try {
      // Convert array to Buffer
      let fileBuffer;
      if (Array.isArray(fileData)) {
        fileBuffer = Buffer.from(fileData);
      } else if (fileData instanceof ArrayBuffer) {
        fileBuffer = Buffer.from(fileData);
      } else if (Buffer.isBuffer(fileData)) {
        fileBuffer = fileData;
      } else {
        // Try to convert to Buffer
        fileBuffer = Buffer.from(fileData);
      }

      const fileId = `${socket.id}_${Date.now()}_${fileName.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      const fileInfo = {
        id: fileId,
        name: fileName,
        size: fileSize || fileBuffer.length,
        data: fileBuffer,
        ownerPeerId: socket.id,
        uploadedAt: Date.now(),
      };

      peerFiles.set(fileId, fileInfo);
      peerInfo.files.push(fileId);
      peerRegistry.set(socket.id, peerInfo);

      console.log(`File uploaded: ${fileName} by ${peerInfo.username} (${fileSize || fileBuffer.length} bytes)`);

      // Notify peer about successful upload
      socket.emit("uploadSuccess", {
        fileId: fileId,
        fileName: fileName,
        message: "File uploaded successfully",
      });

      // Send updated file list to the peer
      socket.emit("myFiles", {
        files: peerInfo.files
          .map((fid) => {
            const fInfo = peerFiles.get(fid);
            return fInfo
              ? {
                  id: fInfo.id,
                  name: fInfo.name,
                  size: fInfo.size,
                  uploadedAt: fInfo.uploadedAt,
                }
              : null;
          })
          .filter((f) => f !== null),
      });

      // Update peer list for all clients
      broadcastPeerList();
    } catch (error) {
      console.error("Error uploading file:", error);
      socket.emit("uploadError", { message: "Error processing file: " + error.message });
    }
  });

  // ---------------- P2P MODULE - GET PEER FILES ----------------
  socket.on("getPeerFiles", (data) => {
    const { targetPeerId } = data;
    const targetPeer = peerRegistry.get(targetPeerId);

    if (!targetPeer) {
      socket.emit("peerFilesError", { message: "Peer not found" });
      return;
    }

    const files = targetPeer.files
      .map((fileId) => {
        const fileInfo = peerFiles.get(fileId);
        if (!fileInfo) return null;
        return {
          id: fileInfo.id,
          name: fileInfo.name,
          size: fileInfo.size,
        };
      })
      .filter((f) => f !== null);

    socket.emit("peerFiles", { files: files, peerId: targetPeerId });
  });

  // ---------------- P2P MODULE - GET MY FILES ----------------
  socket.on("getMyFiles", () => {
    const peerInfo = peerRegistry.get(socket.id);
    if (!peerInfo) {
      socket.emit("myFiles", { files: [] });
      return;
    }

    const files = peerInfo.files
      .map((fileId) => {
        const fileInfo = peerFiles.get(fileId);
        if (!fileInfo) return null;
        return {
          id: fileInfo.id,
          name: fileInfo.name,
          size: fileInfo.size,
          uploadedAt: fileInfo.uploadedAt,
        };
      })
      .filter((f) => f !== null);

    socket.emit("myFiles", { files: files });
  });

  // ---------------- P2P MODULE - REQUEST FILE ----------------
  socket.on("requestFile", (data) => {
    const { targetPeerId, fileId } = data;
    const fileInfo = peerFiles.get(fileId);

    if (!fileInfo) {
      socket.emit("fileRequestError", { message: "File not found" });
      return;
    }

    if (fileInfo.ownerPeerId !== targetPeerId) {
      socket.emit("fileRequestError", { message: "File owner mismatch" });
      return;
    }

    // Find the owner's socket and request permission
    const ownerSocket = io.sockets.sockets.get(targetPeerId);
    if (!ownerSocket) {
      socket.emit("fileRequestError", { message: "Peer offline" });
      return;
    }

    // Get requester's username
    const requesterPeer = peerRegistry.get(socket.id);
    const requesterUsername = requesterPeer ? requesterPeer.username : "Unknown";

    // Request permission from owner
    ownerSocket.emit("fileRequest", {
      fromPeerId: socket.id,
      fileId: fileId,
      fileName: fileInfo.name,
      requesterUsername: requesterUsername,
    });

    console.log(`File request: ${requesterUsername} (${socket.id}) requested ${fileInfo.name} from peer ${targetPeerId}`);
    socket.emit("fileRequestSent", { message: "File request sent to peer" });
  });

  // ---------------- P2P MODULE - SEND FILE (AFTER PERMISSION) ----------------
  socket.on("sendFile", (data) => {
    const { toPeerId, fileId } = data;
    const fileInfo = peerFiles.get(fileId);

    if (!fileInfo) {
      socket.emit("sendFileError", { message: "File not found" });
      return;
    }

    if (fileInfo.ownerPeerId !== socket.id) {
      socket.emit("sendFileError", { message: "You don't own this file" });
      return;
    }

    const recipientSocket = io.sockets.sockets.get(toPeerId);
    if (!recipientSocket) {
      socket.emit("sendFileError", { message: "Recipient peer offline" });
      return;
    }

    try {
      // Convert Buffer to array for JSON serialization
      let fileDataArray;
      if (Buffer.isBuffer(fileInfo.data)) {
        fileDataArray = Array.from(fileInfo.data);
      } else if (fileInfo.data instanceof Uint8Array) {
        fileDataArray = Array.from(fileInfo.data);
      } else if (Array.isArray(fileInfo.data)) {
        fileDataArray = fileInfo.data;
      } else {
        // Try to convert to array
        fileDataArray = Array.from(new Uint8Array(fileInfo.data));
      }

      // Send file to requesting peer
      recipientSocket.emit("fileReceived", {
        file: {
          name: fileInfo.name,
          size: fileInfo.size,
          data: fileDataArray,
        },
      });

      console.log(`File sent: ${fileInfo.name} (${fileInfo.size} bytes) from ${socket.id} to ${toPeerId}`);
      socket.emit("sendFileSuccess", { message: "File sent successfully" });
    } catch (error) {
      console.error("Error sending file:", error);
      socket.emit("sendFileError", { message: "Error processing file data" });
    }
  });

  // ---------------- P2P MODULE - DISCONNECT CLEANUP ----------------
  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);

    // Clean up peer registration
    if (peerRegistry.has(socket.id)) {
      const peerInfo = peerRegistry.get(socket.id);
      console.log(`Peer disconnected: ${peerInfo.username} (${socket.id})`);

      // Remove peer's files from global registry
      peerInfo.files.forEach((fileId) => {
        peerFiles.delete(fileId);
      });

      peerRegistry.delete(socket.id);
      broadcastPeerList();
    }
  });
});

// Helper function to broadcast peer list to all connected clients
function broadcastPeerList() {
  const peerList = Array.from(peerRegistry.values()).map((peer) => ({
    peerId: peer.peerId,
    username: peer.username,
    fileCount: peer.files.length,
  }));

  io.emit("peerListUpdate", peerList);
}

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

/* ---------------- MESS FEEDBACK (SHARED MEMORY WITH SYNCHRONIZATION) ---------------- */
app.post("/api/mess-feedback", async (req, res) => {
  const { feedback } = req.body;
  const userId = req.session.userId;

  if (!userId) {
    return res.status(401).json({ success: false });
  }

  if (!["Good", "Average", "Poor"].includes(feedback)) {
    return res.status(400).json({
      success: false,
      message: "Invalid feedback type",
    });
  }

  // Acquire lock (mutex) - wait if locked
  while (feedbackLock) {
    await new Promise((resolve) => setTimeout(resolve, 10)); // Wait 10ms and retry
  }

  try {
    // Critical section - only one thread can execute this at a time
    feedbackLock = true;

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

    // Atomic increment operation (protected by lock)
    messFeedbackCounts[feedback] = (messFeedbackCounts[feedback] || 0) + 1;
    saveFeedback(); // Save to file

    console.log(
      "Feedback submitted:",
      feedback,
      "Total counts:",
      messFeedbackCounts,
      "User:",
      userId
    );

    // Broadcast update to all clients
    io.emit("feedbackUpdate", { counts: { ...messFeedbackCounts } });

    res.json({
      success: true,
      counts: { ...messFeedbackCounts },
      remaining: 3 - (count + 1),
    });
  } finally {
    // Release lock
    feedbackLock = false;
  }
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
