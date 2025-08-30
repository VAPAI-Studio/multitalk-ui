import { supabase } from './supabase'

/**
 * Test function to verify Supabase Storage is working correctly
 */
export async function testSupabaseUpload() {
  try {
    console.log('🧪 Testing Supabase Storage upload...')
    
    // Create a small test video blob (just a few bytes for testing)
    const testBlob = new Blob(['test video content'], { type: 'video/mp4' })
    const testFileName = `test_${Date.now()}.mp4`
    const storagePath = `videos/test/${testFileName}`
    
    console.log('📤 Uploading test file:', { storagePath, size: testBlob.size })
    
    // Upload to Supabase Storage
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('multitalk-videos')
      .upload(storagePath, testBlob, {
        contentType: 'video/mp4',
        cacheControl: '3600',
        upsert: true
      })
    
    if (uploadError) {
      console.error('❌ Upload failed:', uploadError)
      return { success: false, error: uploadError.message }
    }
    
    console.log('✅ Upload successful:', uploadData)
    
    // Get public URL
    const { data: urlData } = supabase.storage
      .from('multitalk-videos')
      .getPublicUrl(storagePath)
    
    if (!urlData?.publicUrl) {
      console.error('❌ Failed to get public URL')
      return { success: false, error: 'Failed to get public URL' }
    }
    
    console.log('✅ Public URL generated:', urlData.publicUrl)
    
    // Test if the URL is accessible
    try {
      const testResponse = await fetch(urlData.publicUrl, { method: 'HEAD' })
      console.log('✅ File accessible via URL:', testResponse.status === 200)
    } catch (e) {
      console.warn('⚠️ Could not verify file accessibility:', e)
    }
    
    // Clean up test file
    try {
      const { error: deleteError } = await supabase.storage
        .from('multitalk-videos')
        .remove([storagePath])
      
      if (deleteError) {
        console.warn('⚠️ Could not delete test file:', deleteError)
      } else {
        console.log('🗑️ Test file cleaned up')
      }
    } catch (e) {
      console.warn('⚠️ Error cleaning up test file:', e)
    }
    
    return { 
      success: true, 
      publicUrl: urlData.publicUrl,
      uploadData 
    }
    
  } catch (error: any) {
    console.error('❌ Test failed with error:', error)
    return { 
      success: false, 
      error: error.message || 'Unknown error during test'
    }
  }
}