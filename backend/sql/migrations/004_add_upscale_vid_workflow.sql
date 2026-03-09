-- Add upscale-vid workflow to the workflows reference table
INSERT INTO workflows (name, output_type, display_name, description)
VALUES ('upscale-vid', 'video', 'Video Upscale', 'Upscale videos to higher resolutions with AI-powered super-resolution using SeedVR2')
ON CONFLICT (name) DO NOTHING;
