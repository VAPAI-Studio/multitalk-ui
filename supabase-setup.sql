-- SQL script to set up the MultiTalk jobs table in Supabase
-- Run this in your Supabase SQL Editor

-- Create the multitalk_jobs table
CREATE TABLE multitalk_jobs (
  job_id VARCHAR PRIMARY KEY,
  status VARCHAR NOT NULL CHECK (status IN ('submitted', 'processing', 'completed', 'error')),
  timestamp_submitted TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  timestamp_completed TIMESTAMPTZ,
  filename VARCHAR,
  subfolder VARCHAR,
  image_filename VARCHAR,
  audio_filename VARCHAR,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  trim_to_audio BOOLEAN NOT NULL DEFAULT FALSE,
  comfy_url VARCHAR NOT NULL,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for better performance
CREATE INDEX idx_multitalk_jobs_status ON multitalk_jobs(status);
CREATE INDEX idx_multitalk_jobs_timestamp_submitted ON multitalk_jobs(timestamp_submitted DESC);
CREATE INDEX idx_multitalk_jobs_timestamp_completed ON multitalk_jobs(timestamp_completed DESC);
CREATE INDEX idx_multitalk_jobs_comfy_url ON multitalk_jobs(comfy_url);

-- Create a function to automatically update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger to automatically update updated_at
CREATE TRIGGER update_multitalk_jobs_updated_at 
    BEFORE UPDATE ON multitalk_jobs 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- Grant permissions (adjust as needed for your security requirements)
-- This allows anonymous users to read/write jobs - you may want to restrict this
ALTER TABLE multitalk_jobs ENABLE ROW LEVEL SECURITY;

-- Example policy - allows all operations for now
-- You should customize this based on your security needs
CREATE POLICY "Allow all operations on multitalk_jobs" ON multitalk_jobs
    FOR ALL 
    USING (true)
    WITH CHECK (true);