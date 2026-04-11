import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import pkg from "pg";

const { Pool } = pkg;
const app = express();
app.use(cors());
app.use(bodyParser.json());

// ✅ Supabase PostgreSQL connection via environment variable
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

// ✅ Test DB connection
pool
  .connect()
  .then(() => console.log("✅ Connected to Supabase PostgreSQL"))
  .catch((err) => console.error("❌ Connection error:", err.stack));

// ====================== ADMIN ======================

app.get("/admin", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM admin");
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).send("Database query failed");
  }
});

// ====================== FACULTY ======================

app.get("/faculty/count", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT COUNT(*) AS faculty_count FROM faculty"
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).send("Query failed");
  }
});

// ✅ Health check endpoint
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

// ✅ Vercel serverless handler
export default app;

// ✅ Local development server
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});

// ====================== LOGIN ROUTES ======================

// Faculty Login
app.post("/login/faculty", async (req, res) => {
  const { email_id, password } = req.body;
  try {
    const result = await pool.query(
      "SELECT * FROM faculty WHERE email_id = $1 AND password = $2",
      [email_id, password]
    );
    if (result.rows.length === 0)
      return res.status(401).json({ message: "Invalid credentials" });

    res.json({
      message: "Login successful",
      user: result.rows[0],
      role: "faculty",
    });
  } catch (err) {
    console.error("Faculty login error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Incharge Login
app.post("/login/incharge", async (req, res) => {
  const { email_id, password } = req.body;
  try {
    const result = await pool.query(
      "SELECT * FROM incharge WHERE email_id = $1 AND password = $2",
      [email_id, password]
    );
    if (result.rows.length === 0)
      return res.status(401).json({ message: "Invalid credentials" });

    res.json({
      message: "Login successful",
      user: result.rows[0],
      role: "incharge",
    });
  } catch (err) {
    console.error("Incharge login error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Worker Login
app.post("/login/worker", async (req, res) => {
  const { mobile_no, password } = req.body;
  try {
    const result = await pool.query(
      "SELECT * FROM workers WHERE mobile_no = $1 AND password = $2",
      [mobile_no, password]
    );
    if (result.rows.length === 0)
      return res.status(401).json({ message: "Invalid credentials" });

    res.json({
      message: "Login successful",
      user: result.rows[0],
      role: "worker",
    });
  } catch (err) {
    console.error("Worker login error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Admin Login
app.post("/login/admin", async (req, res) => {
  const { email_id, password } = req.body;
  try {
    const result = await pool.query(
      "SELECT * FROM admin WHERE email_id = $1 AND password = $2",
      [email_id, password]
    );
    if (result.rows.length === 0)
      return res.status(401).json({ message: "Invalid credentials" });

    res.json({
      message: "Login successful",
      user: result.rows[0],
      role: "admin",
    });
  } catch (err) {
    console.error("Admin login error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ====================== BUILDING MANAGEMENT ======================

// Get all buildings
app.get("/buildings", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT building_id, building_name FROM building ORDER BY building_name ASC"
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Error fetching buildings:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ====================== COMPLAINT MANAGEMENT ======================

// Register new complaint (auto-assign incharge based on category + building_id)
app.post("/complaints", async (req, res) => {
  const { category, type, classroom, description, faculty_id, building_id } =
    req.body;

  try {
    // 1️⃣ Find incharge based on category AND building_id
    const inchargeResult = await pool.query(
      `SELECT name FROM incharge 
       WHERE role = $1 AND building_id = $2 
       LIMIT 1`,
      [category, building_id]
    );

    if (inchargeResult.rows.length === 0) {
      return res.status(400).json({
        error: "No incharge found for this category in this building",
      });
    }

    const assignedIncharge = inchargeResult.rows[0].name;

    // 2️⃣ Insert complaint with building_id
    const insertResult = await pool.query(
      `INSERT INTO complaints
       (category, type, classroom, status, description, faculty_id, assigned_incharge, building_id, created_at)
       VALUES ($1, $2, $3, 'Pending', $4, $5, $6, $7, NOW())
       RETURNING *`,
      [
        category,
        type,
        classroom,
        description,
        faculty_id,
        assignedIncharge,
        building_id,
      ]
    );

    res.status(201).json({
      message: "Complaint registered successfully",
      complaint: insertResult.rows[0],
    });
  } catch (err) {
    console.error("Error inserting complaint:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ====================== FETCH COMPLAINTS WITH FILTERING ======================

// All complaints (admin view) - WITH STATUS FILTERING
app.get("/complaints/all", async (req, res) => {
  const { status } = req.query;
  try {
    let query = "SELECT * FROM complaints";
    let params = [];

    if (status && status !== "total") {
      query += " WHERE status = $1";
      params.push(status);
    }

    query += " ORDER BY created_at DESC";

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error("Error fetching complaints:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Complaints for a specific incharge - WITH STATUS FILTERING
app.get("/complaints", async (req, res) => {
  const { incharge, status } = req.query;
  try {
    let query = "SELECT * FROM complaints WHERE assigned_incharge = $1";
    let params = [incharge];

    if (status && status !== "total") {
      query += " AND status = $2";
      params.push(status);
    }

    query += " ORDER BY created_at DESC";

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error("Error fetching incharge complaints:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Complaints for a worker - WITH STATUS FILTERING
app.get("/complaints/worker/:name", async (req, res) => {
  const { name } = req.params;
  const { status } = req.query;
  try {
    let query = "SELECT * FROM complaints WHERE worker = $1";
    let params = [name];

    if (status && status !== "total") {
      query += " AND status = $2";
      params.push(status);
    }

    query += " ORDER BY created_at DESC";

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error("Error fetching worker complaints:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Complaints for a faculty - WITH STATUS FILTERING
app.get("/complaints/faculty/:faculty_id", async (req, res) => {
  const { faculty_id } = req.params;
  const { status } = req.query;
  try {
    let query = "SELECT * FROM complaints WHERE faculty_id = $1";
    let params = [faculty_id];

    if (status && status !== "total") {
      query += " AND status = $2";
      params.push(status);
    }

    query += " ORDER BY created_at DESC";

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error("Error fetching faculty complaints:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ====================== WORKER MANAGEMENT ======================

// Get all workers of same role/category by building_id
app.get("/workers/:role/:building_id", async (req, res) => {
  const { role, building_id } = req.params;

  try {
    const result = await pool.query(
      `SELECT * FROM workers 
       WHERE role = $1 AND building_id = $2
       ORDER BY name ASC`,
      [role, building_id]
    );

    res.json(result.rows);
  } catch (err) {
    console.error("Error fetching workers:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get all categories/roles
app.get("/categories", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT DISTINCT role FROM incharge ORDER BY role ASC"
    );
    res.json(result.rows.map((row) => row.role));
  } catch (err) {
    console.error("Error fetching categories:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Assign worker to complaint
app.put("/complaints/:id/assign", async (req, res) => {
  const { id } = req.params;
  const { worker } = req.body;
  try {
    const result = await pool.query(
      "UPDATE complaints SET worker = $1, status = 'In Progress' WHERE id = $2 RETURNING *",
      [worker, id]
    );
    res.json({
      message: "Worker assigned successfully",
      complaint: result.rows[0],
    });
  } catch (err) {
    console.error("Error assigning worker:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Update complaint status
app.put("/complaints/:id/status", async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  try {
    const result = await pool.query(
      "UPDATE complaints SET status = $1 WHERE id = $2 RETURNING *",
      [status, id]
    );
    res.json({
      message: "Status updated successfully",
      complaint: result.rows[0],
    });
  } catch (err) {
    console.error("Error updating status:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ====================== PASSWORD MANAGEMENT ======================

app.put("/change-password/:userType/:userId", async (req, res) => {
  const { userType, userId } = req.params;
  const { newPassword } = req.body;

  try {
    let query, params;

    switch (userType) {
      case "faculty":
        query =
          "UPDATE faculty SET password = $1 WHERE faculty_id = $2 RETURNING faculty_name as name";
        params = [newPassword, userId];
        break;
      case "incharge":
        query =
          "UPDATE incharge SET password = $1 WHERE email_id = $2 RETURNING name";
        params = [newPassword, userId];
        break;
      case "worker":
        query =
          "UPDATE workers SET password = $1 WHERE mobile_no = $2 RETURNING name";
        params = [newPassword, userId];
        break;
      case "admin":
        query =
          "UPDATE admin SET password = $1 WHERE email_id = $2 RETURNING name";
        params = [newPassword, userId];
        break;
      default:
        return res.status(400).json({ error: "Invalid user type" });
    }

    const result = await pool.query(query, params);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json({
      message: "Password updated successfully",
      user: result.rows[0],
    });
  } catch (err) {
    console.error("Error updating password:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ====================== SERVER ======================
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));

export default app;