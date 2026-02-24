-- Blocker database schema
-- This file defines the database structure for the blocker service

CREATE TABLE IF NOT EXISTS blocked_users (
    username VARCHAR(255) PRIMARY KEY,
    reason VARCHAR(1000) NULL
);
