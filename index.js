const express = require('express');
const bodyParser = require('body-parser');
const { Pool } = require('pg');
const app = express();
const axios = require('axios')
const port = 8080;
const dotenv = require('dotenv')

const PORT = process.env.NODE_DOCKER_PORT || 8080;

// PostgreSQL pool setup
const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'alemeno-task',
    password: '12345',
    port: 5432,
});

app.use(express.json())
app.use(bodyParser.urlencoded({ extended: true }));


// Register new user
app.post('/register', async (req, res) => {
    const userData = req.body;
    id = Math.floor(Math.random() * 1000000);
    let idExists = false;
    do {
        const result = await pool.query('SELECT * FROM customer_data WHERE "Customer ID" = $1', [id]);
        if (result.rows.length > 0) {
            id = Math.floor(Math.random() * 1000000);
        } else {
            idExists = true;
        }
    } while (!idExists);
    const approvedLimit = Math.round(36 * userData.monthly_income / 100000) * 100000;

    try {
        const result = await pool.query('INSERT INTO customer_data("Customer ID", "First Name", "Last Name", "Age", "Monthly Salary", "Phone Number", "Approved Limit") VALUES($1, $2, $3, $4, $5, $6, $7) RETURNING *',
            [id, userData.first_name, userData.last_name, userData.age, userData.monthly_income, userData.phone_number, approvedLimit]);
        res.status(201).json({ message: 'User registered successfully', user: result.rows[0] });
    } catch (error) {
        res.status(500).json({ message: 'Error registering user', error: error.message });
    }
});

// Check loan eligibility
// NOTE: LOAN ACTIVITY IN CURRENT YEAR CANNOT BE DETERMINED FROM THE GIVEN TABLES AS THEY ONLY MENTION THE EXTREME ENDS OF THE LOAN DURATION.
//       LOAN APPROVED VOLUME CANNOT BE DETERMINED IN THE given DATASETS BECAUSE THERE IS NO COMMON customer_id BETWEEN THE TWO TABLES.
// NOTE: THE CREDIT SCORE CALCULATION IS DERIVED ON THE BASIS OF RUNNING MEAN AND MAXIMUM VALUES PRESENT IN THE GIVEN DATABASE. THE VALUES ARE USED SUCH THAT
//       THE CREDIT SCORE IS BETWEEN 0-100 and IS A WHOLE NUMBER.
app.post('/check-eligibility', async (req, res) => {
    const { customer_id, loan_amount, interest_rate, tenure } = req.body;
    const result = await pool.query('SELECT * FROM loan_data WHERE "Customer ID" = $1', [customer_id]);
    const loanData = result.rows;
    const result2 = await pool.query('SELECT * FROM customer_data WHERE "Customer ID" = $1', [customer_id]);
    const customerData = result2.rows;
    EMIsPaidOnTime = 0;
    noOfLoans = loanData.length;
    approvedLoanLimit = 1e9;
    totLoanAmount = 0;
    if (customerData.length > 0) {
        approvedLoanLimit = customerData[0]["Approved Limir"];
    }

    for (const loan of loanData) {
        EMIsPaidOnTime += loan["EMIs paid on Time"];
        totLoanAmount += loan["Loan Amount"];
    }
    if (totLoanAmount > approvedLoanLimit) {
        try {
            res.json({ message: 'Eligibility checked', eligibility: 'NOT eligible' });
        } catch (error) {
            res.status(500).json({ message: 'Error checking eligibility', error: error.message });
        }
    }
    const credScore = Math.floor(EMIsPaidOnTime / 172 * 40 + totLoanAmount / 1e5 - noOfLoans * 4);
    const resp = {
        'customer_id': customer_id,
        'approval': false,
        'interest_rate': interest_rate,
        'corrected_interest_rate': interest_rate,
        'tenure': tenure,
        'monthly_installment': loan_amount / tenure
    }

    if (credScore < 10) {
        try {
            res.json({ resp });
        } catch (error) {
            res.status(500).json({ message: 'Error checking eligibility', error: error.message });
        }
    }
    interest_rate_new = interest_rate;
    resp['approval'] = true;
    if (credScore < 50 && credScore > 30) {
        interest_rate_new = 12;
    } else if (credScore > 10) {
        interest_rate_new = 16;
    }
    resp['corrected_interest_rate'] = interest_rate_new;
    try {
        const result = await pool.query('INSERT INTO loan_data("Customer ID", "Loan Amount", "Interest Rate", "Tenure") VALUES($1, $2, $3, $4) RETURNING *',
            [customer_id, loan_amount, interest_rate, tenure]);
        res.status(201).json(resp);
    } catch (error) {
        res.status(500).json({ message: 'Error registering user', error: error.message });
    }
});

// Create a new loan
// NOTE: THE LOAN APPROVAL STATUS IS DETERMINED BY THE CHECK-ELIGIBILITY API. THE LOAN IS APPROVED IF THE CUSTOMER IS ELIGIBLE.
//       THIS REQUEST IS ALMOST SIMILAR TO THE CHECK-ELIGIBILITY API, THEREFORE THAT IS USED TO EXECUTE THIS FUNCTIONALITY AS WELL.
app.post('/create-loan/', async (req, res) => {
    const { customer_id, loan_amount, interest_rate, tenure } = req.body;
    const response = await axios.post('http://localhost:8080/check-eligibility', req.body);

    if (!response.data.approval) {
        response.data.message = 'Loan not approved';
    } else {
        response.data.message = 'Loan approved';
    }

    try {
        res.status(201).json(response.data);
    } catch (error) {
        res.status(500).json({ message: 'Error creating loan', error: error.message });
    }
});

// View loan details
app.get('/view-loan/:loan_id', async (req, res) => {
    const loanId = req.params.loan_id;
    try {
        const result = await pool.query('SELECT * FROM loan_data WHERE "Loan ID" = $1', [loanId]);
        loanData = result.rows[0];
        const custResult = await pool.query('SELECT ("First Name", "Last Name", "Phone Number", "Age") FROM customer_data WHERE "Customer ID" = $1', [loanData["Customer ID"]]);
        const custData = custResult.rows[0];
        delete loanData["Date of Approval"];
        delete loanData["End Date"];
        loanData.customer = custData;
        res.json(loanData);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching loan details', error: error.message });
    }
});

// Make a payment
// NOTE: HERE, THERE IS NO MENTION OF WHERE THE AMOUNT PAID IS PASSED TO THE API. THEREFORE, I HAVE ASSUMED THAT THE AMOUNT IS FIXED AND IS EQUAL TO THE MONTHLY INSTALLMENT.
//       THAT IS WHY THERE IS NO QUESTION OF WHETHER THE AMOUNT IS GREATER/LESS THAN THE MONTHLY INSTALLMENT. HENCE, I'VE SIMPLY INCREMENTED THE NUMBER OF EMIs PAID ON TIME.
app.get('/make-payment/:customer_id/:loan_id', async (req, res) => {
    const customerId = req.params.customer_id;
    const loanId = req.params.loan_id;
    const paymentData = req.body;

    const result = await pool.query('SELECT * FROM loan_data WHERE "Loan ID" = $1', [loanId]);
    var loanData = result.rows[0];
    var EMIsPaidOnTime = loanData["EMIs paid on Time"];
    EMIsPaidOnTime += 1;
    try {
        const result2 = await pool.query('UPDATE loan_data SET "EMIs paid on Time" = $1 WHERE "Loan ID" = $2 RETURNING *',
            [EMIsPaidOnTime, loanId]);
        loanData = result2.rows[0];
    } catch (error) {
        res.status(500).json({ message: 'Error making payment', error: error.message });
    }
    console.log('loan data:', result.rows[0]);
    try {
        delete loanData["Date of Approval"];
        delete loanData["End Date"];
        res.json(loanData);
    } catch (error) {
        res.status(500).json({ message: 'Error making payment', error: error.message });
    }
});

// View statement
app.get('/view-statement/:customer_id/:loan_id', async (req, res) => {
    const customerId = req.params.customer_id;
    const loanId = req.params.loan_id;
    try {
        const result = await pool.query('SELECT * FROM loan_data WHERE "Loan ID" = $1', [loanId]);
        const loanData = result.rows[0];
        delete loanData["Date of Approval"];
        delete loanData["End Date"];
        loanData["Repayments Left"] = loanData["Tenure"] - loanData["EMIs paid on Time"];
        res.json(loanData);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching statement', error: error.message });
    }
});

// Start the server
app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
