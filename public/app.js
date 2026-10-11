
const API = "/api";

let token = localStorage.getItem("bankToken");
let currentUser = JSON.parse(localStorage.getItem("bankUser") || "null");
let accounts = [];

const money = n =>
  "₹" + Number(n || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });

const headers = () => ({
  "Content-Type": "application/json",
  ...(token ? { Authorization: "Bearer " + token } : {})
});

// API request function
async function request(url, options = {}) {
  const res = await fetch(API + url, {
    ...options,
    cache: "no-store",
    headers: {
      ...headers(),
      ...(options.headers || {})
    }
  });

  const data = await res.json().catch(() => ({
    message: "Unexpected server response"
  }));

  if (!res.ok) {
    throw new Error(data.message || "Request failed");
  }

  return data;
}

// Toast message
function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.className = "toast";

  setTimeout(() => {
    el.textContent = "";
    el.className = "";
  }, 3200);
}

// Login and registration screens
function showAuth(which) {
  document.getElementById("loginForm").classList.toggle("hidden", which !== "login");
  document.getElementById("registerForm").classList.toggle("hidden", which !== "register");

  document.querySelectorAll(".tab").forEach((b, i) => {
    b.classList.toggle("active", i === (which === "login" ? 0 : 1));
  });
}

// Registration
async function register(e) {
  e.preventDefault();

  try {
    const data = await request("/auth/register", {
      method: "POST",
      body: JSON.stringify({
        full_name: document.getElementById("regName").value.trim(),
        email: document.getElementById("regEmail").value.trim(),
        password: document.getElementById("regPassword").value,
        phone: document.getElementById("regPhone").value.trim()
      })
    });

    toast(data.message);
    e.target.reset();
    showAuth("login");

  } catch (err) {
    toast(err.message);
    console.error("Registration error:", err);
  }
}

// Login
async function login(e) {
  e.preventDefault();

  try {
    const data = await request("/auth/login", {
      method: "POST",
      body: JSON.stringify({
        email: document.getElementById("loginEmail").value.trim(),
        password: document.getElementById("loginPassword").value
      })
    });

    token = data.token;
    currentUser = data.user;

    localStorage.setItem("bankToken", token);
    localStorage.setItem("bankUser", JSON.stringify(currentUser));

    await openApp();

  } catch (err) {
    toast(err.message);
    console.error("Login error:", err);
  }
}

// Logout
function logout() {
  localStorage.removeItem("bankToken");
  localStorage.removeItem("bankUser");

  token = null;
  currentUser = null;
  accounts = [];

  document.getElementById("app").classList.add("hidden");
  document.getElementById("authScreen").classList.remove("hidden");
}

// Open dashboard
async function openApp() {
  try {
    currentUser = await request("/me");

    localStorage.setItem("bankUser", JSON.stringify(currentUser));

    document.getElementById("authScreen").classList.add("hidden");
    document.getElementById("app").classList.remove("hidden");

    const name = currentUser.full_name || "User";

    document.getElementById("sideName").textContent = name;
    document.getElementById("topName").textContent = name;
    document.getElementById("welcomeName").textContent = name.split(" ")[0];

    document.getElementById("sideAvatar").textContent = name[0].toUpperCase();
    document.getElementById("topAvatar").textContent = name[0].toUpperCase();

    document.getElementById("todayDate").textContent =
      new Date().toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric"
      });

    await loadAccounts();
    await loadDashboard();

  } catch (err) {
    console.error("Dashboard loading error:", err);
    toast("Dashboard loading failed: " + err.message);

    // Log out only when authentication is actually invalid.
    if (err.message.toLowerCase().includes("token") ||
        err.message.toLowerCase().includes("unauthorized")) {
      logout();
    }
  }
}

// Navigation
function navigate(page) {
  document.querySelectorAll(".page").forEach(p => p.classList.add("hidden"));

  document.getElementById(page + "Page").classList.remove("hidden");

  document.querySelectorAll(".nav").forEach(n => {
    n.classList.toggle("active", n.dataset.page === page);
  });

  const titles = {
    dashboard: "Overview",
    accounts: "My accounts",
    transfer: "Transfer money",
    transactions: "Transactions",
    bills: "Bill payments",
    loans: "Loans",
    recurring: "Recurring payments"
  };

  document.getElementById("pageTitle").textContent = titles[page];

  if (page === "transactions") loadTransactions();
  if (page === "bills") loadBills();
  if (page === "loans") loadLoans();
  if (page === "recurring") loadRecurring();
  if (page === "accounts") renderAccounts();
}

// Accounts
async function loadAccounts() {
  accounts = await request("/accounts");

  const opts = accounts.map(a =>
    `<option value="${a.id}">${a.account_number} — ${a.account_type}</option>`
  ).join("");

  ["transferAccount", "billAccount", "recAccount"].forEach(id => {
    document.getElementById(id).innerHTML =
      opts || '<option value="">No account</option>';
  });

  renderAccounts();
}

function renderAccounts() {
  document.getElementById("accountsList").innerHTML =
    accounts.length
      ? accounts.map(a => `
        <div class="account-card">
          <h3>${a.account_type} ACCOUNT</h3>
          <strong>${money(a.balance)}</strong>
          <p>Account number: ${a.account_number}</p>
        </div>
      `).join("")
      : '<div class="empty">No accounts found.</div>';
}

// Dashboard
async function loadDashboard() {
  const d = await request("/dashboard");

  document.getElementById("totalBalance").textContent = money(d.total_balance);
  document.getElementById("accountCount").textContent = d.account_count;
  document.getElementById("activityCount").textContent = d.transactions.length;

  document.getElementById("recentTable").innerHTML = table(d.transactions);
}

// Tables
function table(rows) {
  if (!rows.length) {
    return '<div class="empty">No records found.</div>';
  }

  return `
    <table class="data-table">
      <thead>
        <tr>
          <th>DESCRIPTION</th>
          <th>DATE</th>
          <th>TYPE</th>
          <th>AMOUNT</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(r => `
          <tr>
            <td>${r.description || r.bill_type || r.payee || "-"}</td>
            <td>${new Date(r.created_at || r.next_date).toLocaleDateString()}</td>
            <td>${r.transaction_type || r.status || r.frequency || "-"}</td>
            <td class="${r.transaction_type === "CREDIT" ? "credit" : r.transaction_type === "DEBIT" ? "debit" : ""}">
              ${money(r.amount)}
            </td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

// Money transfer
async function transfer(e) {
  e.preventDefault();

  try {
    const d = await request("/transfer", {
      method: "POST",
      body: JSON.stringify({
        from_account_id: document.getElementById("transferAccount").value,
        to_account_number: document.getElementById("receiverAccount").value.trim(),
        amount: document.getElementById("transferAmount").value
      })
    });

    toast(d.message + " Ref: " + d.reference_id);
    e.target.reset();
    await refreshData();

  } catch (err) {
    toast(err.message);
    console.error("Transfer error:", err);
  }
}

// Transactions
async function loadTransactions() {
  document.getElementById("transactionsTable").innerHTML =
    table(await request("/transactions"));
}

// Bill payments
async function payBill(e) {
  e.preventDefault();

  try {
    const d = await request("/bills", {
      method: "POST",
      body: JSON.stringify({
        account_id: document.getElementById("billAccount").value,
        bill_type: document.getElementById("billType").value,
        consumer_number: document.getElementById("consumerNumber").value,
        amount: document.getElementById("billAmount").value
      })
    });

    toast(d.message);
    e.target.reset();
    await refreshData();
    loadBills();

  } catch (err) {
    toast(err.message);
    console.error("Bill payment error:", err);
  }
}

async function loadBills() {
  document.getElementById("billsTable").innerHTML =
    table(await request("/bills"));
}

// Loans
async function applyLoan(e) {
  e.preventDefault();

  try {
    const d = await request("/loans", {
      method: "POST",
      body: JSON.stringify({
        loan_type: document.getElementById("loanType").value,
        amount: document.getElementById("loanAmount").value,
        purpose: document.getElementById("loanPurpose").value
      })
    });

    toast(d.message);
    e.target.reset();
    loadLoans();

  } catch (err) {
    toast(err.message);
    console.error("Loan error:", err);
  }
}

async function loadLoans() {
  const rows = await request("/loans");

  document.getElementById("loansTable").innerHTML =
    rows.length
      ? `
        <table class="data-table">
          <thead>
            <tr>
              <th>LOAN TYPE</th>
              <th>AMOUNT</th>
              <th>PURPOSE</th>
              <th>STATUS</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(r => `
              <tr>
                <td>${r.loan_type}</td>
                <td>${money(r.amount)}</td>
                <td>${r.purpose || "-"}</td>
                <td><span class="badge">${r.status}</span></td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      `
      : '<div class="empty">No loan applications yet.</div>';
}

// Recurring payments
async function addRecurring(e) {
  e.preventDefault();

  try {
    const d = await request("/recurring", {
      method: "POST",
      body: JSON.stringify({
        account_id: document.getElementById("recAccount").value,
        payee: document.getElementById("recPayee").value,
        amount: document.getElementById("recAmount").value,
        frequency: document.getElementById("recFrequency").value,
        next_date: document.getElementById("recDate").value
      })
    });

    toast(d.message);
    e.target.reset();
    loadRecurring();

  } catch (err) {
    toast(err.message);
    console.error("Recurring payment error:", err);
  }
}

async function loadRecurring() {
  const rows = await request("/recurring");

  document.getElementById("recurringTable").innerHTML =
    rows.length
      ? `
        <table class="data-table">
          <thead>
            <tr>
              <th>PAYEE</th>
              <th>AMOUNT</th>
              <th>FREQUENCY</th>
              <th>NEXT DATE</th>
              <th>STATUS</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(r => `
              <tr>
                <td>${r.payee}</td>
                <td>${money(r.amount)}</td>
                <td>${r.frequency}</td>
                <td>${new Date(r.next_date).toLocaleDateString()}</td>
                <td><span class="badge">${r.status}</span></td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      `
      : '<div class="empty">No recurring schedules yet.</div>';
}

// Refresh dashboard data
async function refreshData() {
  await loadAccounts();
  await loadDashboard();
}

// Restore session on page refresh
if (token) {
  openApp();
}
