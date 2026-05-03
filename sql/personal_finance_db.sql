CREATE DATABASE IF NOT EXISTS personal_finance_db;
USE personal_finance_db;

DROP TABLE IF EXISTS audit_logs;
DROP TABLE IF EXISTS savings_goals;
DROP TABLE IF EXISTS budgets;
DROP TABLE IF EXISTS transactions;
DROP TABLE IF EXISTS users;

CREATE TABLE users (
  user_id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(120) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  initial_balance DECIMAL(12,2) NOT NULL CHECK (initial_balance >= 0),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE transactions (
  transaction_id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  transaction_type ENUM('income', 'expense') NOT NULL,
  category VARCHAR(80) NOT NULL,
  amount DECIMAL(12,2) NOT NULL CHECK (amount > 0),
  transaction_date DATE NOT NULL,
  description VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_transactions_user
    FOREIGN KEY (user_id) REFERENCES users(user_id)
    ON DELETE CASCADE
);

CREATE TABLE budgets (
  budget_id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  category VARCHAR(80) NOT NULL,
  budget_limit DECIMAL(12,2) NOT NULL CHECK (budget_limit > 0),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  CONSTRAINT fk_budgets_user
    FOREIGN KEY (user_id) REFERENCES users(user_id)
    ON DELETE CASCADE
);

CREATE TABLE savings_goals (
  goal_id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  goal_name VARCHAR(100) NOT NULL,
  target_amount DECIMAL(12,2) NOT NULL CHECK (target_amount > 0),
  current_saved DECIMAL(12,2) NOT NULL DEFAULT 0 CHECK (current_saved >= 0),
  target_date DATE,
  CONSTRAINT fk_savings_user
    FOREIGN KEY (user_id) REFERENCES users(user_id)
    ON DELETE CASCADE
);

CREATE TABLE audit_logs (
  log_id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT,
  action_name VARCHAR(120) NOT NULL,
  action_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  details VARCHAR(255),
  CONSTRAINT fk_audit_user
    FOREIGN KEY (user_id) REFERENCES users(user_id)
    ON DELETE SET NULL
);

CREATE OR REPLACE VIEW vw_user_finance_summary AS
SELECT
  u.user_id,
  u.name,
  u.email,
  u.initial_balance,
  COALESCE(SUM(CASE WHEN t.transaction_type = 'income' THEN t.amount END), 0) AS total_income,
  COALESCE(SUM(CASE WHEN t.transaction_type = 'expense' THEN t.amount END), 0) AS total_expense,
  u.initial_balance
    + COALESCE(SUM(CASE WHEN t.transaction_type = 'income' THEN t.amount END), 0)
    - COALESCE(SUM(CASE WHEN t.transaction_type = 'expense' THEN t.amount END), 0) AS current_balance
FROM users u
LEFT JOIN transactions t ON u.user_id = t.user_id
GROUP BY u.user_id, u.name, u.email, u.initial_balance;

CREATE OR REPLACE VIEW vw_budget_usage AS
SELECT
  b.budget_id,
  b.user_id,
  b.category,
  b.budget_limit,
  COALESCE(SUM(t.amount), 0) AS used_amount,
  ROUND((COALESCE(SUM(t.amount), 0) / b.budget_limit) * 100, 2) AS usage_percentage
FROM budgets b
LEFT JOIN transactions t
  ON b.user_id = t.user_id
  AND LOWER(b.category) = LOWER(t.category)
  AND t.transaction_type = 'expense'
  AND t.transaction_date BETWEEN b.start_date AND b.end_date
GROUP BY b.budget_id, b.user_id, b.category, b.budget_limit;

DELIMITER //

CREATE PROCEDURE sp_register_user (
  IN p_name VARCHAR(100),
  IN p_email VARCHAR(120),
  IN p_password_hash VARCHAR(255),
  IN p_initial_balance DECIMAL(12,2)
)
BEGIN
  INSERT INTO users (name, email, password_hash, initial_balance)
  VALUES (p_name, p_email, p_password_hash, p_initial_balance);
END//

CREATE PROCEDURE sp_add_transaction (
  IN p_user_id INT,
  IN p_transaction_type ENUM('income', 'expense'),
  IN p_category VARCHAR(80),
  IN p_amount DECIMAL(12,2),
  IN p_transaction_date DATE,
  IN p_description VARCHAR(255)
)
BEGIN
  INSERT INTO transactions
    (user_id, transaction_type, category, amount, transaction_date, description)
  VALUES
    (p_user_id, p_transaction_type, p_category, p_amount, p_transaction_date, p_description);
END//

CREATE PROCEDURE sp_get_user_report (IN p_user_id INT)
BEGIN
  SELECT * FROM vw_user_finance_summary WHERE user_id = p_user_id;

  SELECT
    category,
    SUM(CASE WHEN transaction_type = 'income' THEN amount ELSE 0 END) AS income_amount,
    SUM(CASE WHEN transaction_type = 'expense' THEN amount ELSE 0 END) AS expense_amount,
    SUM(CASE WHEN transaction_type = 'income' THEN amount ELSE -amount END) AS net_amount
  FROM transactions
  WHERE user_id = p_user_id
  GROUP BY category;
END//

CREATE PROCEDURE sp_cursor_budget_alerts (IN p_user_id INT)
BEGIN
  DECLARE done INT DEFAULT 0;
  DECLARE v_budget_id INT;
  DECLARE v_category VARCHAR(80);
  DECLARE v_usage DECIMAL(8,2);

  DECLARE budget_cursor CURSOR FOR
    SELECT budget_id, category, usage_percentage
    FROM vw_budget_usage
    WHERE user_id = p_user_id;

  DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = 1;

  OPEN budget_cursor;

  read_loop: LOOP
    FETCH budget_cursor INTO v_budget_id, v_category, v_usage;
    IF done = 1 THEN
      LEAVE read_loop;
    END IF;

    IF v_usage >= 80 THEN
      INSERT INTO audit_logs (user_id, action_name, details)
      VALUES (p_user_id, 'BUDGET_ALERT', CONCAT(v_category, ' budget usage is ', v_usage, '%'));
    END IF;
  END LOOP;

  CLOSE budget_cursor;
END//

CREATE TRIGGER trg_transaction_insert_audit
AFTER INSERT ON transactions
FOR EACH ROW
BEGIN
  INSERT INTO audit_logs (user_id, action_name, details)
  VALUES (
    NEW.user_id,
    'TRANSACTION_ADDED',
    CONCAT(NEW.transaction_type, ' added in ', NEW.category)
  );
END//

CREATE TRIGGER trg_prevent_negative_wallet
BEFORE INSERT ON transactions
FOR EACH ROW
BEGIN
  DECLARE v_current_balance DECIMAL(12,2);

  SELECT current_balance
  INTO v_current_balance
  FROM vw_user_finance_summary
  WHERE user_id = NEW.user_id;

  IF NEW.transaction_type = 'expense' AND NEW.amount > v_current_balance THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Expense cannot exceed current wallet balance';
  END IF;
END//

DELIMITER ;

-- Sample data for evaluation.
-- These values represent amounts typed by a sample user during registration and transaction entry.
SET @sample_name = 'Sample User';
SET @sample_email = 'sample.pfms@example.com';
SET @sample_password_hash = SHA2('sample-password', 256);
SET @sample_initial_balance = 0.00;
SET @sample_income_amount = 1.00;
SET @sample_expense_amount = @sample_income_amount / 2;
SET @sample_budget_limit = @sample_income_amount;
SET @sample_goal_target = @sample_income_amount * 2;
SET @sample_goal_saved = @sample_expense_amount;

START TRANSACTION;
SAVEPOINT before_sample_user;

CALL sp_register_user(
  @sample_name,
  @sample_email,
  @sample_password_hash,
  @sample_initial_balance
);

SET @sample_user_id = LAST_INSERT_ID();

INSERT INTO budgets (user_id, category, budget_limit, start_date, end_date)
VALUES
  (@sample_user_id, 'Food', @sample_budget_limit, CURRENT_DATE, DATE_ADD(CURRENT_DATE, INTERVAL 30 DAY));

INSERT INTO savings_goals (user_id, goal_name, target_amount, current_saved, target_date)
VALUES
  (@sample_user_id, 'First Goal', @sample_goal_target, @sample_goal_saved, DATE_ADD(CURRENT_DATE, INTERVAL 90 DAY));

CALL sp_add_transaction(
  @sample_user_id,
  'income',
  'Allowance',
  @sample_income_amount,
  CURRENT_DATE,
  'Sample income entered by user'
);

CALL sp_add_transaction(
  @sample_user_id,
  'expense',
  'Food',
  @sample_expense_amount,
  CURRENT_DATE,
  'Sample expense entered by user'
);

-- Use ROLLBACK TO SAVEPOINT before_sample_user; to undo the sample inserts during demonstration.
COMMIT;

-- JOIN: transactions with users.
SELECT
  u.name,
  t.transaction_type,
  t.category,
  t.amount,
  t.transaction_date
FROM users u
JOIN transactions t ON u.user_id = t.user_id;

-- SUBQUERY: users whose expense is above their own average expense.
SELECT *
FROM transactions t
WHERE t.transaction_type = 'expense'
  AND t.amount > (
    SELECT AVG(t2.amount)
    FROM transactions t2
    WHERE t2.user_id = t.user_id
      AND t2.transaction_type = 'expense'
  );

-- Demonstration transaction block with SAVEPOINT and ROLLBACK.
START TRANSACTION;
SAVEPOINT before_demo_budget_change;
UPDATE budgets
SET budget_limit = budget_limit + 1
WHERE user_id = @sample_user_id;
ROLLBACK TO SAVEPOINT before_demo_budget_change;
COMMIT;
