require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const mysql = require("mysql2/promise");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const pool = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "online_banking",
  waitForConnections: true,
  connectionLimit: 10
});
const SECRET = process.env.JWT_SECRET || "demo_secret_change_me";

function auth(req, res, next) {
  const token = (req.headers.authorization || "").replace("Bearer ", "");
  if (!token) return res.status(401).json({ message: "Please login first." });
  try {
    req.user = jwt.verify(token, SECRET);
    next();
  } catch {
    return res.status(401).json({ message: "Session expired. Login again." });
  }
}
const makeRef = () => "TXN" + Date.now() + Math.floor(Math.random() * 1000);

app.get("/api/health", async (req, res) => {
  try { await pool.query("SELECT 1"); res.json({ status: "OK", database: "connected" }); }
  catch (e) { res.status(500).json({ status: "ERROR", message: e.message }); }
});

app.post("/api/auth/register", async (req, res) => {
  try {
    const { full_name, email, password, phone } = req.body;
    if (!full_name || !email || !password) return res.status(400).json({ message: "Name, email and password are required." });
    if (password.length < 6) return res.status(400).json({ message: "Password must contain at least 6 characters." });
    const [existing] = await pool.query("SELECT id FROM users WHERE email=?", [email]);
    if (existing.length) return res.status(409).json({ message: "Email already registered." });
    const hash = await bcrypt.hash(password, 10);
    const [result] = await pool.query("INSERT INTO users(full_name,email,password,phone) VALUES(?,?,?,?)", [full_name, email, hash, phone || null]);
    const accountNumber = "OB" + String(Date.now()).slice(-10) + String(result.insertId).padStart(2, "0");
    await pool.query("INSERT INTO accounts(user_id,account_number,balance) VALUES(?,?,?)", [result.insertId, accountNumber, 10000]);
    res.status(201).json({ message: "Registration successful. Please login." });
  } catch (e) { res.status(500).json({ message: "Registration failed.", error: e.message }); }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const [rows] = await pool.query("SELECT * FROM users WHERE email=?", [email]);
    if (!rows.length || !(await bcrypt.compare(password || "", rows[0].password)))
      return res.status(401).json({ message: "Invalid email or password." });
    const user = rows[0];
    const token = jwt.sign({ id: user.id, email: user.email }, SECRET, { expiresIn: "8h" });
    res.json({ token, user: { id: user.id, full_name: user.full_name, email: user.email, phone: user.phone } });
  } catch (e) { res.status(500).json({ message: "Login failed.", error: e.message }); }
});

app.get("/api/me", auth, async (req, res) => {
  const [[user]] = await pool.query("SELECT id,full_name,email,phone,created_at FROM users WHERE id=?", [req.user.id]);
  if (!user) return res.status(404).json({ message: "User not found." });
  res.json(user);
});

app.get("/api/accounts", auth, async (req, res) => {
  const [rows] = await pool.query("SELECT id,account_number,account_type,balance,created_at FROM accounts WHERE user_id=? ORDER BY id", [req.user.id]);
  res.json(rows);
});

app.get("/api/dashboard", auth, async (req, res) => {
  const [[totals]] = await pool.query("SELECT COUNT(*) AS account_count, COALESCE(SUM(balance),0) AS total_balance FROM accounts WHERE user_id=?", [req.user.id]);
  const [transactions] = await pool.query("SELECT id,transaction_type,amount,description,reference_id,created_at FROM transactions WHERE user_id=? ORDER BY id DESC LIMIT 5", [req.user.id]);
  res.json({ ...totals, transactions });
});

app.post("/api/transfer", auth, async (req, res) => {
  const { from_account_id, to_account_number, amount } = req.body;
  const value = Number(amount);
  if (!from_account_id || !to_account_number || !Number.isFinite(value) || value <= 0) return res.status(400).json({ message: "Enter valid transfer details." });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[from]] = await conn.query("SELECT * FROM accounts WHERE id=? AND user_id=? FOR UPDATE", [from_account_id, req.user.id]);
    const [[to]] = await conn.query("SELECT * FROM accounts WHERE account_number=? FOR UPDATE", [to_account_number]);
    if (!from || !to) throw new Error("Source or receiver account was not found.");
    if (from.id === to.id) throw new Error("Cannot transfer to the same account.");
    if (Number(from.balance) < value) throw new Error("Insufficient balance.");
    const ref = makeRef();
    await conn.query("UPDATE accounts SET balance=balance-? WHERE id=?", [value, from.id]);
    await conn.query("UPDATE accounts SET balance=balance+? WHERE id=?", [value, to.id]);
    await conn.query("INSERT INTO transactions(user_id,account_id,transaction_type,amount,description,reference_id) VALUES(?,?,?,?,?,?)",
      [req.user.id, from.id, "DEBIT", value, "Transfer to " + to_account_number, ref]);
    await conn.query("INSERT INTO transactions(user_id,account_id,transaction_type,amount,description,reference_id) VALUES(?,?,?,?,?,?)",
      [to.user_id, to.id, "CREDIT", value, "Transfer received", ref]);
    await conn.commit();
    res.json({ message: "Transfer successful.", reference_id: ref });
  } catch (e) { await conn.rollback(); res.status(400).json({ message: e.message }); }
  finally { conn.release(); }
});

app.get("/api/transactions", auth, async (req, res) => {
  const [rows] = await pool.query("SELECT t.*,a.account_number FROM transactions t JOIN accounts a ON a.id=t.account_id WHERE t.user_id=? ORDER BY t.created_at DESC LIMIT 100", [req.user.id]);
  res.json(rows);
});

app.post("/api/bills", auth, async (req, res) => {
  const { account_id, bill_type, consumer_number, amount } = req.body;
  const value = Number(amount);
  if (!account_id || !bill_type || !Number.isFinite(value) || value <= 0) return res.status(400).json({ message: "Enter valid bill details." });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[account]] = await conn.query("SELECT * FROM accounts WHERE id=? AND user_id=? FOR UPDATE", [account_id, req.user.id]);
    if (!account) throw new Error("Account not found.");
    if (Number(account.balance) < value) throw new Error("Insufficient balance.");
    await conn.query("UPDATE accounts SET balance=balance-? WHERE id=?", [value, account_id]);
    await conn.query("INSERT INTO bill_payments(user_id,account_id,bill_type,consumer_number,amount) VALUES(?,?,?,?,?)", [req.user.id, account_id, bill_type, consumer_number || "", value]);
    await conn.query("INSERT INTO transactions(user_id,account_id,transaction_type,amount,description,reference_id) VALUES(?,?,?,?,?,?)", [req.user.id, account_id, "DEBIT", value, bill_type + " bill payment", makeRef()]);
    await conn.commit();
    res.json({ message: "Bill payment successful." });
  } catch (e) { await conn.rollback(); res.status(400).json({ message: e.message }); }
  finally { conn.release(); }
});

app.get("/api/bills", auth, async (req, res) => {
  const [rows] = await pool.query("SELECT * FROM bill_payments WHERE user_id=? ORDER BY created_at DESC", [req.user.id]);
  res.json(rows);
});

app.post("/api/loans", auth, async (req, res) => {
  const { loan_type, amount, purpose } = req.body;
  const value = Number(amount);
  if (!loan_type || !Number.isFinite(value) || value <= 0) return res.status(400).json({ message: "Enter valid loan details." });
  await pool.query("INSERT INTO loans(user_id,loan_type,amount,purpose) VALUES(?,?,?,?)", [req.user.id, loan_type, value, purpose || ""]);
  res.json({ message: "Loan application submitted. Status: Pending." });
});
app.get("/api/loans", auth, async (req, res) => {
  const [rows] = await pool.query("SELECT * FROM loans WHERE user_id=? ORDER BY created_at DESC", [req.user.id]);
  res.json(rows);
});

app.post("/api/recurring", auth, async (req, res) => {
  const { account_id, payee, amount, frequency, next_date } = req.body;
  const value = Number(amount);
  if (!account_id || !payee || !Number.isFinite(value) || value <= 0 || !frequency || !next_date) return res.status(400).json({ message: "Complete all recurring payment fields." });
  const [result] = await pool.query("INSERT INTO recurring_payments(user_id,account_id,payee,amount,frequency,next_date) VALUES(?,?,?,?,?,?)", [req.user.id, account_id, payee, value, frequency, next_date]);
  res.json({ message: "Recurring payment created. This demo records the schedule; it does not automatically debit money.", id: result.insertId });
});
app.get("/api/recurring", auth, async (req, res) => {
  const [rows] = await pool.query("SELECT * FROM recurring_payments WHERE user_id=? ORDER BY next_date", [req.user.id]);
  res.json(rows);
});

app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Online Banking System running at http://localhost:${PORT}`));
