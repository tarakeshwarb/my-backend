import bodyParser from "body-parser";
import cors from "cors";
import express from "express";
import pkg from "pg";

const { Pool } = pkg;

const app = express();
app.use(cors());
app.use(bodyParser.json());

// Debug environment
console.log("DATABASE_URL exists:", !!process.env.DATABASE_URL);
console.log(
  "DATABASE_URL host:",
  process.env.DATABASE_URL ? process.env.DATABASE_URL.split("@")[1] : "NOT SET"
);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

pool
  .connect()
  .then(() => console.log("Connected to Supabase PostgreSQL"))
  .catch((err) => console.error("Connection error:", err.stack));

const complaintBaseSelect = `
  SELECT
    c.*,
    COALESCE(f.faculty_name, c.faculty_id) AS faculty_name,
    b.building_name
  FROM complaints c
  LEFT JOIN faculty f ON f.faculty_id = c.faculty_id
  LEFT JOIN building b ON b.building_id = c.building_id
`;

// ====================== ADMIN ======================

app.get("/admin", async (_req, res) => {
  try {
    const result = await pool.query("SELECT * FROM admin");
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).send("Database query failed");
  }
});

// ====================== FACULTY ======================

app.get("/faculty/count", async (_req, res) => {
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

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// ====================== LOGIN ROUTES ======================

app.post("/login/faculty", async (req, res) => {
  const { email_id, password } = req.body;
  try {
    const result = await pool.query(
      "SELECT * FROM faculty WHERE email_id = $1 AND password = $2",
      [email_id, password]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    return res.json({
      message: "Login successful",
      user: result.rows[0],
      role: "faculty",
    });
  } catch (err) {
    console.error("Faculty login error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/login/incharge", async (req, res) => {
  const { email_id, password } = req.body;
  try {
    const result = await pool.query(
      "SELECT * FROM incharge WHERE email_id = $1 AND password = $2",
      [email_id, password]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    return res.json({
      message: "Login successful",
      user: result.rows[0],
      role: "incharge",
    });
  } catch (err) {
    console.error("Incharge login error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/login/worker", async (req, res) => {
  const { mobile_no, password } = req.body;
  try {
    const result = await pool.query(
      "SELECT * FROM workers WHERE mobile_no = $1 AND password = $2",
      [mobile_no, password]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    return res.json({
      message: "Login successful",
      user: result.rows[0],
      role: "worker",
    });
  } catch (err) {
    console.error("Worker login error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/login/admin", async (req, res) => {
  const { email_id, password } = req.body;
  try {
    const result = await pool.query(
      "SELECT * FROM admin WHERE email_id = $1 AND password = $2",
      [email_id, password]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    return res.json({
      message: "Login successful",
      user: result.rows[0],
      role: "admin",
    });
  } catch (err) {
    console.error("Admin login error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ====================== BUILDING MANAGEMENT ======================

app.get("/buildings", async (_req, res) => {
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

app.post("/complaints", async (req, res) => {
  const { category, type, classroom, description, faculty_id, building_id } =
    req.body;

  if (!category || !type || !classroom || !description || !faculty_id || !building_id) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    // Match incharge by category + building, case-insensitive to avoid text mismatch issues.
    const inchargeResult = await pool.query(
      `SELECT name FROM incharge
       WHERE TRIM(LOWER(role)) = TRIM(LOWER($1))
         AND building_id = $2
       LIMIT 1`,
      [category, building_id]
    );

    if (inchargeResult.rows.length === 0) {
      return res.status(400).json({
        error: "No incharge found for this category in this building",
      });
    }

    const assignedIncharge = inchargeResult.rows[0].name;

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

    return res.status(201).json({
      message: "Complaint registered successfully",
      complaint: insertResult.rows[0],
    });
  } catch (err) {
    console.error("Error inserting complaint:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ====================== FETCH COMPLAINTS WITH FILTERING ======================

app.get("/complaints/all", async (req, res) => {
  const { status } = req.query;

  try {
    let query = complaintBaseSelect;
    const params = [];

    if (status && status !== "total") {
      query += " WHERE c.status = $1";
      params.push(status);
    }

    query += " ORDER BY c.created_at DESC";

    const result = await pool.query(query, params);
    return res.json(result.rows);
  } catch (err) {
    console.error("Error fetching complaints:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/complaints", async (req, res) => {
  const { incharge, status } = req.query;

  if (!incharge) {
    return res.status(400).json({ error: "incharge query param is required" });
  }

  try {
    let query = `${complaintBaseSelect} WHERE c.assigned_incharge = $1`;
    const params = [incharge];

    if (status && status !== "total") {
      query += " AND c.status = $2";
      params.push(status);
    }

    query += " ORDER BY c.created_at DESC";

    const result = await pool.query(query, params);
    return res.json(result.rows);
  } catch (err) {
    console.error("Error fetching incharge complaints:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/complaints/worker/:name", async (req, res) => {
  const { name } = req.params;
  const { status } = req.query;

  try {
    let query = `${complaintBaseSelect} WHERE c.worker = $1`;
    const params = [name];

    if (status && status !== "total") {
      query += " AND c.status = $2";
      params.push(status);
    }

    query += " ORDER BY c.created_at DESC";

    const result = await pool.query(query, params);
    return res.json(result.rows);
  } catch (err) {
    console.error("Error fetching worker complaints:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/complaints/faculty/:faculty_id", async (req, res) => {
  const { faculty_id } = req.params;
  const { status } = req.query;

  try {
    let query = `${complaintBaseSelect} WHERE c.faculty_id = $1`;
    const params = [faculty_id];

    if (status && status !== "total") {
      query += " AND c.status = $2";
      params.push(status);
    }

    query += " ORDER BY c.created_at DESC";

    const result = await pool.query(query, params);
    return res.json(result.rows);
  } catch (err) {
    console.error("Error fetching faculty complaints:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ====================== WORKER MANAGEMENT ======================

app.get("/workers/:role/:building_id", async (req, res) => {
  const { role, building_id } = req.params;

  try {
    const result = await pool.query(
      `SELECT * FROM workers
       WHERE TRIM(LOWER(role)) = TRIM(LOWER($1))
         AND building_id = $2
       ORDER BY name ASC`,
      [role, building_id]
    );

    return res.json(result.rows);
  } catch (err) {
    console.error("Error fetching workers:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/categories", async (_req, res) => {
  try {
    const result = await pool.query(
      "SELECT DISTINCT role FROM incharge ORDER BY role ASC"
    );
    return res.json(result.rows.map((row) => row.role));
  } catch (err) {
    console.error("Error fetching categories:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

app.put("/complaints/:id/assign", async (req, res) => {
  const { id } = req.params;
  const { worker } = req.body;

  try {
    const result = await pool.query(
      "UPDATE complaints SET worker = $1, status = 'In Progress' WHERE id = $2 RETURNING *",
      [worker, id]
    );

    return res.json({
      message: "Worker assigned successfully",
      complaint: result.rows[0],
    });
  } catch (err) {
    console.error("Error assigning worker:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

app.put("/complaints/:id/status", async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  try {
    const result = await pool.query(
      "UPDATE complaints SET status = $1 WHERE id = $2 RETURNING *",
      [status, id]
    );

    return res.json({
      message: "Status updated successfully",
      complaint: result.rows[0],
    });
  } catch (err) {
    console.error("Error updating status:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ====================== PASSWORD MANAGEMENT ======================

app.put("/change-password/:userType/:userId", async (req, res) => {
  const { userType, userId } = req.params;
  const { newPassword } = req.body;

  try {
    let query;
    let params;

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

    return res.json({
      message: "Password updated successfully",
      user: result.rows[0],
    });
  } catch (err) {
    console.error("Error updating password:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default app;

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
