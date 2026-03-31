-- ============================================================================
-- SEED DATA
-- ============================================================================

-- ============================================================================
-- 1. Workflows table
-- ============================================================================
INSERT INTO workflows (name, output_type, display_name, description)
SELECT * FROM (VALUES
    ('lipsync-one', 'video', 'Lipsync 1 Person', 'Generate talking videos from a single person image with custom audio'),
    ('lipsync-multi', 'video', 'Lipsync Multi Person', 'Create conversations between multiple people with synchronized audio'),
    ('video-lipsync', 'video', 'Video Lipsync', 'Add lip-sync to existing videos with new audio tracks'),
    ('wan-i2v', 'video', 'WAN I2V', 'Transform images into videos with AI-powered generation'),
    ('wan-move', 'video', 'WAN Move', 'Add motion to images using WAN model'),
    ('ltx-i2v', 'video', 'LTX I2V', 'Image to video using LTX model'),
    ('img2img', 'image', 'Img2Img', 'Transform images using AI'),
    ('style-transfer', 'image', 'Style Transfer', 'Transfer artistic styles between images'),
    ('image-edit', 'image', 'Image Edit', 'Edit images using AI with natural language instructions'),
    ('character-caption', 'text', 'Character Caption', 'Generate detailed captions for character images')
) AS v(name, output_type, display_name, description)
WHERE NOT EXISTS (SELECT 1 FROM workflows LIMIT 1);

-- ============================================================================
-- 2. Storage Buckets
-- ============================================================================

-- Create storage buckets for file uploads
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
    ('multitalk-videos', 'multitalk-videos', true, 524288000, ARRAY['video/mp4', 'video/webm', 'video/quicktime']),
    ('edited-images', 'edited-images', true, 52428800, ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']),
    ('training-outputs', 'training-outputs', true, 524288000, NULL)
ON CONFLICT (id) DO NOTHING;

-- Set up storage policies (allow authenticated users to upload/read)
CREATE POLICY "Allow authenticated uploads to multitalk-videos"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'multitalk-videos');

CREATE POLICY "Allow public reads from multitalk-videos"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'multitalk-videos');

CREATE POLICY "Allow authenticated uploads to edited-images"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'edited-images');

CREATE POLICY "Allow public reads from edited-images"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'edited-images');

CREATE POLICY "Allow authenticated uploads to training-outputs"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'training-outputs');

CREATE POLICY "Allow public reads from training-outputs"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'training-outputs');
