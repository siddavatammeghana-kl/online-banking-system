ONLINE BANKING SYSTEM - QUICK START

IMPORTANT: This is a college demonstration project. It uses simulated funds.
Do not use real bank credentials or real customer data.

1. Install Node.js (LTS) and MySQL.
2. Open this folder in VS Code.
3. Open MySQL Workbench and run all contents of database.sql.
   This creates/uses database: online_banking
4. In VS Code terminal, run:
      npm install
5. Copy .env.example to a new file named .env
6. Edit .env and enter your MySQL password after DB_PASSWORD=
   Example:
      DB_HOST=localhost
      DB_USER=root
      DB_PASSWORD=your_mysql_password
      DB_NAME=online_banking
      JWT_SECRET=use_a_long_random_secret
7. Start the server:
      npm start
8. Open browser:
      http://localhost:5000
9. Click Create account, register a user, then login.
   New demo users receive a simulated account with ₹10,000 starting balance.
10. To test transfers, register a second user in another browser/incognito
    session and use that user's account number as receiver.

TROUBLESHOOTING
- "Access denied": check DB_USER and DB_PASSWORD in .env.
- "Unknown database": run database.sql in MySQL Workbench.
- "ECONNREFUSED": start MySQL service.
- "Cannot find module": run npm install in the project folder.
- Port 5000 busy: change PORT=5001 in .env and visit localhost:5001.

PROJECT MODULES
Registration/login, dashboard, accounts, money transfer, transactions,
bill payments, loan requests, recurring payment schedule.

SECURITY / DEMO NOTES
Passwords are hashed with bcryptjs. API routes use JWT authentication.
Money transfers use a MySQL transaction and row locks.
Recurring payment setup only saves a schedule; it does not auto-debit.
OTP/MFA, real bank rails, SMS/email, and production security certification
are not implemented in this demo.
