import React, { useState, useEffect } from "react";
import { io } from "socket.io-client";
import axios from "axios";
import "./Dashboard.css";

const StudentDashboard = ({ user, onLogout }) => {
  const [activeTab, setActiveTab] = useState("complaints");
  const [socket, setSocket] = useState(null);
  const [complaints, setComplaints] = useState([]);
  const [complaintAcknowledgment, setComplaintAcknowledgment] = useState(null);
  const [notices, setNotices] = useState([]);
  const [searchRoom, setSearchRoom] = useState("");
  const [searchResult, setSearchResult] = useState(null);

  // Module 5: Shared Memory
  const [feedbackCounts, setFeedbackCounts] = useState({
    Good: 0,
    Average: 0,
    Poor: 0,
  });

  // Module 4: P2P
  const [peers, setPeers] = useState([]);
  const [selectedPeer, setSelectedPeer] = useState(null);
  const [peerFiles, setPeerFiles] = useState([]);

  const [complaintForm, setComplaintForm] = useState({
    roomNumber: "",
    category: "Water",
    description: "",
  });

  useEffect(() => {
    const newSocket = io("http://localhost:5000");
    setSocket(newSocket);

    // ---------------- SOCKET EVENTS ----------------
    newSocket.on("complaintAcknowledgment", setComplaintAcknowledgment);
    newSocket.on("complaintsList", setComplaints);
    newSocket.on("newComplaint", (c) => setComplaints((prev) => [c, ...prev]));

    // ----------- P2P EVENTS -----------
    newSocket.on("peerListUpdate", setPeers);
    newSocket.on("peerList", setPeers);
    newSocket.on("peerFiles", (data) => setPeerFiles(data.files || []));

    newSocket.on("fileReceived", (data) => {
      alert(`File received: ${data.file.name}`);
      const blob = new Blob([data.file.data]);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = data.file.name;
      a.click();
    });

    newSocket.on("fileRequest", (data) => {
      if (window.confirm(`Peer requested ${data.fileName}. Send?`)) {
        newSocket.emit("sendFile", {
          toPeerId: data.fromPeerId,
          fileId: data.fileId,
        });
      }
    });

    // -------- SHARED MEMORY UPDATES --------
    newSocket.on("feedbackUpdate", (data) => {
      setFeedbackCounts(data.counts);
    });

    // -------- NOTICES UPDATES --------
    newSocket.on("newNotice", (notice) => {
      console.log("New notice received via socket:", notice);
      setNotices((prev) => {
        // Check if notice already exists to avoid duplicates
        const exists = prev.some((n) => Number(n.id) === Number(notice.id));
        if (exists) {
          return prev;
        }
        return [notice, ...prev];
      });
    });

    // Initial requests
    newSocket.emit("getComplaints");
    newSocket.emit("registerPeer", { username: user.username });
    newSocket.emit("getPeerList");

    loadNotices();
    loadFeedbackCounts();

    return () => {
      newSocket.disconnect();
    };
  }, [user.username]);

  // ---------------- REST CALLS ----------------
  const loadNotices = async () => {
    try {
      const res = await axios.get("http://localhost:5000/api/notices");
      setNotices(res.data);
    } catch (err) {
      console.error(err);
    }
  };

  const loadFeedbackCounts = async () => {
    try {
      const res = await axios.get(
        "http://localhost:5000/api/mess-feedback/live"
      );
      setFeedbackCounts(res.data.counts);
    } catch (err) {
      console.error(err);
    }
  };

  // ---------------- COMPLAINT ----------------
  const handleSubmitComplaint = (e) => {
    e.preventDefault();
    if (!socket) {
      alert("Connection lost. Please refresh the page.");
      return;
    }

    if (!complaintForm.roomNumber || !complaintForm.description) {
      alert("Please fill in all fields");
      return;
    }

    socket.emit("submitComplaint", {
      userId: user.username,
      roomNumber: complaintForm.roomNumber,
      category: complaintForm.category,
      description: complaintForm.description,
    });

    setComplaintForm({ roomNumber: "", category: "Water", description: "" });
  };

  // ---------------- FEEDBACK ----------------
  const handleSubmitFeedback = async (feedback) => {
  try {
    const res = await axios.post(
      "http://localhost:5000/api/mess-feedback",
      { feedback },
      { withCredentials: true }
    );

    alert(`Feedback submitted. Remaining today: ${res.data.remaining}`);
    setFeedbackCounts(res.data.counts);
  } catch (err) {
    alert(err.response?.data?.message || "Feedback limit reached");
  }
};


  // ---------------- RMI (REST WRAPPER) ----------------
  const handleRoomSearch = async (e) => {
    e.preventDefault();
    try {
      const res = await axios.get(
        `http://localhost:5000/api/rooms/search?roomNo=${searchRoom}`
      );
      if (res.data.success && res.data.room) {
        setSearchResult({
          roomNumber: res.data.room.roomNo,
          occupants: res.data.room.occupantNames.length,
          capacity: 2,
          warden: res.data.room.wardenContact,
        });
      } else {
        setSearchResult(null);
        alert("Room not found");
      }
    } catch (err) {
      console.error("Room search error:", err);
      alert("Error searching room");
    }
  };

  // ---------------- P2P ----------------
  const handleSelectPeer = (peer) => {
    setSelectedPeer(peer.peerId);
    socket.emit("getPeerFiles", { targetPeerId: peer.peerId });
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file || !socket) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      socket.emit("uploadFile", {
        fileName: file.name,
        fileSize: file.size,
        fileData: ev.target.result,
      });
    };
    reader.readAsArrayBuffer(file);
  };

  const handleDownloadFile = (file) => {
    socket.emit("requestFile", {
      targetPeerId: selectedPeer,
      fileId: file.id,
    });
  };

  // ---------------- UI ----------------
  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <h1>🧑‍🎓 Student Dashboard</h1>
        <button onClick={onLogout} className="logout-btn">
          Logout
        </button>
      </header>

      <div className="dashboard-nav">
        {["complaints", "notices", "feedback", "rooms", "resources"].map(
          (tab) => (
            <button
              key={tab}
              className={activeTab === tab ? "active" : ""}
              onClick={() => setActiveTab(tab)}
            >
              {tab.toUpperCase()}
            </button>
          )
        )}
      </div>

      <div className="dashboard-content">
        {/* COMPLAINTS TAB */}
        {activeTab === "complaints" && (
          <>
            <h2>📋 File a Complaint</h2>
            <form onSubmit={handleSubmitComplaint} className="form-card">
              <div className="form-group">
                <label>Room Number</label>
                <input
                  type="text"
                  value={complaintForm.roomNumber}
                  onChange={(e) =>
                    setComplaintForm({
                      ...complaintForm,
                      roomNumber: e.target.value,
                    })
                  }
                  placeholder="e.g., A101"
                  required
                />
              </div>

              <div className="form-group">
                <label>Category</label>
                <select
                  value={complaintForm.category}
                  onChange={(e) =>
                    setComplaintForm({
                      ...complaintForm,
                      category: e.target.value,
                    })
                  }
                >
                  <option>Water</option>
                  <option>Electricity</option>
                  <option>Plumbing</option>
                  <option>Cleanliness</option>
                  <option>Other</option>
                </select>
              </div>

              <div className="form-group">
                <label>Description</label>
                <textarea
                  value={complaintForm.description}
                  onChange={(e) =>
                    setComplaintForm({
                      ...complaintForm,
                      description: e.target.value,
                    })
                  }
                  placeholder="Describe your issue..."
                  rows="5"
                  required
                />
              </div>

              <button type="submit" className="submit-btn">
                Submit Complaint
              </button>
            </form>

            {complaintAcknowledgment && (
              <div className="success-message">
                <p>
                  ✅{" "}
                  {complaintAcknowledgment.message || complaintAcknowledgment}
                </p>
              </div>
            )}

            <h3>My Complaints</h3>
            {complaints.length === 0 ? (
              <p className="empty-message">No complaints yet</p>
            ) : (
              complaints.map((complaint, idx) => (
                <div key={idx} className="card">
                  <h4>Room {complaint.roomNumber}</h4>
                  <p>
                    <strong>Category:</strong> {complaint.category}
                  </p>
                  <p>
                    <strong>Description:</strong> {complaint.description}
                  </p>
                  <p className="status-badge">
                    {complaint.status || "Pending"}
                  </p>
                </div>
              ))
            )}
          </>
        )}

        {/* NOTICES TAB */}
        {activeTab === "notices" && (
          <>
            <h2>📢 Notices & Announcements</h2>
            {notices.length === 0 ? (
              <p className="empty-message">No notices at this time</p>
            ) : (
              notices.map((notice) => (
                <div key={notice.id} className="card">
                  <h4>{notice.title}</h4>
                  <p>{notice.message}</p>
                  <small>
                    {new Date(notice.createdAt).toLocaleDateString()}
                  </small>
                </div>
              ))
            )}
          </>
        )}

        {/* FEEDBACK TAB */}
        {activeTab === "feedback" && (
          <>
            <h2>⭐ Mess Feedback</h2>
            <div className="form-card">
              <p>How was the food quality today?</p>
              <div className="feedback-buttons">
                <button
                  onClick={() => handleSubmitFeedback("Good")}
                  className="feedback-btn good"
                >
                  👍 Good
                </button>
                <button
                  onClick={() => handleSubmitFeedback("Average")}
                  className="feedback-btn average"
                >
                  👌 Average
                </button>
                <button
                  onClick={() => handleSubmitFeedback("Poor")}
                  className="feedback-btn poor"
                >
                  👎 Poor
                </button>
              </div>
            </div>

            <h3>Feedback Statistics</h3>
            <div className="stats-grid">
              <div className="stat-card">
                <h4>👍 Good</h4>
                <p className="stat-number">{feedbackCounts.Good || 0}</p>
              </div>
              <div className="stat-card">
                <h4>👌 Average</h4>
                <p className="stat-number">{feedbackCounts.Average || 0}</p>
              </div>
              <div className="stat-card">
                <h4>👎 Poor</h4>
                <p className="stat-number">{feedbackCounts.Poor || 0}</p>
              </div>
            </div>
          </>
        )}

        {/* ROOMS TAB */}
        {activeTab === "rooms" && (
          <>
            <h2>🏠 Room Information (RMI)</h2>
            <form onSubmit={handleRoomSearch} className="form-card">
              <div className="form-group">
                <label>Search Room</label>
                <input
                  type="text"
                  value={searchRoom}
                  onChange={(e) => setSearchRoom(e.target.value)}
                  placeholder="e.g., A101"
                  required
                />
              </div>
              <button type="submit" className="submit-btn">
                Search
              </button>
            </form>

            {searchResult && (
              <div className="card">
                <h3>Room Details</h3>
                <p>
                  <strong>Room Number:</strong> {searchResult.roomNumber}
                </p>
                <p>
                  <strong>Occupied By:</strong> {searchResult.occupants}{" "}
                  students
                </p>
                <p>
                  <strong>Warden:</strong> {searchResult.warden?.name}
                </p>
                <p>
                  <strong>Warden Contact:</strong> {searchResult.warden?.phone}
                </p>
                <p>
                  <strong>Email:</strong> {searchResult.warden?.email}
                </p>
              </div>
            )}
          </>
        )}

        {/* RESOURCES TAB */}
        {activeTab === "resources" && (
          <>
            <h2>📁 P2P Resource Sharing</h2>

            <div className="form-card">
              <h3>Upload File</h3>
              <input type="file" onChange={handleFileUpload} accept="*" />
            </div>

            <h3>Available Peers</h3>
            {peers.length === 0 ? (
              <p className="empty-message">No peers online</p>
            ) : (
              <div className="peers-list">
                {peers.map((peer) => (
                  <div key={peer.peerId} className="card">
                    <p>
                      <strong>{peer.username}</strong>
                    </p>
                    <p>
                      <small>{peer.fileCount || 0} files available</small>
                    </p>
                    <button
                      onClick={() => handleSelectPeer(peer)}
                      className="action-btn"
                    >
                      View Files
                    </button>
                  </div>
                ))}
              </div>
            )}

            {selectedPeer && peerFiles.length > 0 && (
              <>
                <h3>Files from Peer</h3>
                {peerFiles.map((file) => (
                  <div key={file.id} className="card">
                    <p>
                      <strong>{file.name}</strong> ({file.size} bytes)
                    </p>
                    <button
                      onClick={() => handleDownloadFile(file)}
                      className="action-btn"
                    >
                      Download
                    </button>
                  </div>
                ))}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default StudentDashboard;
