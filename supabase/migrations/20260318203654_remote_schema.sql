drop extension if exists "pg_net";

create type "public"."job_status" as enum ('pending', 'processing', 'completed', 'failed', 'cancelled');

create sequence "public"."workflows_id_seq";


  create table "public"."api_keys" (
    "id" uuid not null default gen_random_uuid(),
    "user_id" uuid not null,
    "key_hash" text not null,
    "key_prefix" text not null,
    "name" text not null default 'Default'::text,
    "created_at" timestamp with time zone not null default now(),
    "last_used_at" timestamp with time zone,
    "revoked_at" timestamp with time zone
      );


alter table "public"."api_keys" enable row level security;


  create table "public"."batch_job_items" (
    "id" uuid not null default gen_random_uuid(),
    "batch_job_id" uuid not null,
    "item_type" text not null,
    "source_index" integer not null,
    "variation_number" integer not null,
    "image_job_id" uuid,
    "status" text not null,
    "created_at" timestamp with time zone not null default now(),
    "completed_at" timestamp with time zone,
    "output_urls" text[],
    "drive_file_ids" text[],
    "starred" boolean not null default false,
    "deleted" boolean not null default false,
    "error_message" text
      );



  create table "public"."batch_jobs" (
    "id" uuid not null default gen_random_uuid(),
    "user_id" uuid not null,
    "project_folder_id" text not null,
    "project_name" text not null,
    "status" text not null,
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now(),
    "completed_at" timestamp with time zone,
    "total_master_frames" integer not null default 0,
    "completed_master_frames" integer not null default 0,
    "total_jobs" integer not null default 0,
    "completed_jobs" integer not null default 0,
    "failed_jobs" integer not null default 0,
    "script_filename" text,
    "outline_json" jsonb,
    "outline_last_updated" timestamp with time zone,
    "master_frame_variations" integer not null default 3,
    "error_message" text,
    "comfy_url" text not null
      );



  create table "public"."data" (
    "id" uuid not null default gen_random_uuid(),
    "dataset_id" uuid not null,
    "image_url" text not null,
    "image_name" text not null,
    "caption" text,
    "created_at" timestamp with time zone default now()
      );


alter table "public"."data" enable row level security;


  create table "public"."datasets" (
    "id" uuid not null default gen_random_uuid(),
    "name" text not null,
    "character_trigger" text not null,
    "settings" jsonb not null,
    "created_at" timestamp with time zone default now(),
    "updated_at" timestamp with time zone default now()
      );


alter table "public"."datasets" enable row level security;


  create table "public"."image_jobs" (
    "id" uuid not null default extensions.uuid_generate_v4(),
    "user_id" uuid not null,
    "workflow_id" integer not null,
    "status" public.job_status not null default 'pending'::public.job_status,
    "created_at" timestamp with time zone not null default now(),
    "input_image_urls" text[],
    "prompt" text,
    "parameters" jsonb default '{}'::jsonb,
    "output_image_urls" text[],
    "width" integer,
    "height" integer,
    "comfy_job_id" text,
    "comfy_url" text not null,
    "project_id" text,
    "error_message" text,
    "batch_job_id" uuid,
    "batch_item_id" uuid
      );



  create table "public"."project_folders" (
    "id" uuid not null default gen_random_uuid(),
    "project_folder_id" text not null,
    "user_id" uuid not null,
    "project_name" text not null,
    "general_assets_folder_id" text,
    "script_folder_id" text,
    "master_frames_folder_id" text,
    "characters_folder_id" text,
    "props_folder_id" text,
    "settings_folder_id" text,
    "txtai_folder_id" text,
    "imagesai_folder_id" text,
    "imagesai_starred_folder_id" text,
    "structure_valid" boolean not null default false,
    "last_validated_at" timestamp with time zone,
    "validation_error" text,
    "last_synced_at" timestamp with time zone not null default now(),
    "created_at" timestamp with time zone not null default now()
      );



  create table "public"."text_jobs" (
    "id" uuid not null default extensions.uuid_generate_v4(),
    "user_id" uuid,
    "workflow_name" text not null,
    "status" text not null,
    "created_at" timestamp with time zone not null default now(),
    "started_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "processing_time_seconds" integer,
    "input_image_urls" text[],
    "input_text" text,
    "output_text" text,
    "output_data" jsonb,
    "parameters" jsonb default '{}'::jsonb,
    "comfy_job_id" text,
    "comfy_url" text,
    "error_message" text,
    "model_used" text,
    "updated_at" timestamp with time zone default now()
      );


alter table "public"."text_jobs" enable row level security;


  create table "public"."upscale_batches" (
    "id" uuid not null default gen_random_uuid(),
    "user_id" uuid not null,
    "status" text not null default 'pending'::text,
    "resolution" text not null default '2k'::text,
    "creativity" integer not null default 0,
    "sharpen" integer not null default 0,
    "grain" integer not null default 0,
    "fps_boost" boolean not null default false,
    "flavor" text not null default 'vivid'::text,
    "project_id" text,
    "total_videos" integer not null default 0,
    "completed_videos" integer not null default 0,
    "failed_videos" integer not null default 0,
    "created_at" timestamp with time zone not null default now(),
    "started_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "last_heartbeat" timestamp with time zone,
    "paused_at" timestamp with time zone,
    "pause_reason" text,
    "error_message" text
      );



  create table "public"."upscale_videos" (
    "id" uuid not null default gen_random_uuid(),
    "batch_id" uuid not null,
    "user_id" uuid not null,
    "status" text not null default 'pending'::text,
    "queue_position" integer not null,
    "input_filename" text not null,
    "input_storage_url" text not null,
    "input_file_size" bigint,
    "freepik_task_id" text,
    "retry_count" integer not null default 0,
    "output_storage_url" text,
    "output_drive_file_id" text,
    "supabase_upload_status" text default 'pending'::text,
    "drive_upload_status" text default 'pending'::text,
    "duration_seconds" double precision,
    "width" integer,
    "height" integer,
    "created_at" timestamp with time zone not null default now(),
    "started_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "error_message" text
      );



  create table "public"."video_jobs" (
    "id" uuid not null default extensions.uuid_generate_v4(),
    "user_id" uuid not null,
    "workflow_id" integer not null,
    "status" public.job_status not null default 'pending'::public.job_status,
    "created_at" timestamp with time zone not null default now(),
    "input_image_urls" text[],
    "input_audio_urls" text[],
    "input_video_urls" text[],
    "parameters" jsonb default '{}'::jsonb,
    "output_video_urls" text[],
    "thumbnail_url" text,
    "width" integer,
    "height" integer,
    "fps" integer,
    "duration_seconds" double precision,
    "comfy_job_id" text,
    "comfy_url" text not null,
    "project_id" text,
    "error_message" text
      );



  create table "public"."workflows" (
    "id" integer not null default nextval('public.workflows_id_seq'::regclass),
    "name" text not null,
    "output_type" text not null,
    "display_name" text not null,
    "description" text,
    "is_active" boolean default true,
    "created_at" timestamp with time zone default now()
      );


alter table "public"."workflows" enable row level security;

alter sequence "public"."workflows_id_seq" owned by "public"."workflows"."id";

CREATE UNIQUE INDEX api_keys_key_hash_key ON public.api_keys USING btree (key_hash);

CREATE UNIQUE INDEX api_keys_pkey ON public.api_keys USING btree (id);

CREATE UNIQUE INDEX batch_job_items_pkey ON public.batch_job_items USING btree (id);

CREATE UNIQUE INDEX batch_jobs_pkey ON public.batch_jobs USING btree (id);

CREATE UNIQUE INDEX data_pkey ON public.data USING btree (id);

CREATE UNIQUE INDEX datasets_pkey ON public.datasets USING btree (id);

CREATE INDEX idx_api_keys_hash ON public.api_keys USING btree (key_hash) WHERE (revoked_at IS NULL);

CREATE UNIQUE INDEX idx_api_keys_one_active_per_user ON public.api_keys USING btree (user_id) WHERE (revoked_at IS NULL);

CREATE INDEX idx_batch_job_items_batch_job ON public.batch_job_items USING btree (batch_job_id);

CREATE INDEX idx_batch_job_items_composite ON public.batch_job_items USING btree (batch_job_id, status, item_type) WHERE (NOT deleted);

CREATE INDEX idx_batch_job_items_starred ON public.batch_job_items USING btree (starred) WHERE (NOT deleted);

CREATE INDEX idx_batch_job_items_status ON public.batch_job_items USING btree (status);

CREATE INDEX idx_batch_job_items_type ON public.batch_job_items USING btree (item_type);

CREATE INDEX idx_batch_jobs_created_at ON public.batch_jobs USING btree (created_at DESC);

CREATE INDEX idx_batch_jobs_status ON public.batch_jobs USING btree (status);

CREATE INDEX idx_batch_jobs_user_id ON public.batch_jobs USING btree (user_id);

CREATE INDEX idx_data_dataset_id ON public.data USING btree (dataset_id);

CREATE INDEX idx_datasets_updated_at ON public.datasets USING btree (updated_at);

CREATE INDEX idx_image_jobs_batch_item ON public.image_jobs USING btree (batch_item_id);

CREATE INDEX idx_image_jobs_batch_job ON public.image_jobs USING btree (batch_job_id);

CREATE INDEX idx_image_jobs_comfy_job_id ON public.image_jobs USING btree (comfy_job_id);

CREATE INDEX idx_image_jobs_created_at ON public.image_jobs USING btree (created_at DESC);

CREATE INDEX idx_image_jobs_status ON public.image_jobs USING btree (status);

CREATE INDEX idx_image_jobs_user_id ON public.image_jobs USING btree (user_id);

CREATE INDEX idx_image_jobs_user_status_created ON public.image_jobs USING btree (user_id, status, created_at DESC);

CREATE INDEX idx_image_jobs_workflow_id ON public.image_jobs USING btree (workflow_id);

CREATE INDEX idx_project_folders_project_id ON public.project_folders USING btree (project_folder_id);

CREATE INDEX idx_project_folders_user_id ON public.project_folders USING btree (user_id);

CREATE INDEX idx_text_jobs_created_at ON public.text_jobs USING btree (created_at DESC);

CREATE INDEX idx_text_jobs_status ON public.text_jobs USING btree (status);

CREATE INDEX idx_text_jobs_user_id ON public.text_jobs USING btree (user_id);

CREATE INDEX idx_text_jobs_workflow_name ON public.text_jobs USING btree (workflow_name);

CREATE INDEX idx_upscale_batches_heartbeat ON public.upscale_batches USING btree (status, last_heartbeat) WHERE (status = 'processing'::text);

CREATE INDEX idx_upscale_batches_status ON public.upscale_batches USING btree (status);

CREATE INDEX idx_upscale_batches_user ON public.upscale_batches USING btree (user_id, created_at DESC);

CREATE INDEX idx_upscale_videos_batch ON public.upscale_videos USING btree (batch_id, queue_position);

CREATE INDEX idx_upscale_videos_freepik ON public.upscale_videos USING btree (freepik_task_id) WHERE (freepik_task_id IS NOT NULL);

CREATE INDEX idx_upscale_videos_status ON public.upscale_videos USING btree (batch_id, status);

CREATE INDEX idx_video_jobs_comfy_job_id ON public.video_jobs USING btree (comfy_job_id);

CREATE INDEX idx_video_jobs_created_at ON public.video_jobs USING btree (created_at DESC);

CREATE INDEX idx_video_jobs_status ON public.video_jobs USING btree (status);

CREATE INDEX idx_video_jobs_user_id ON public.video_jobs USING btree (user_id);

CREATE INDEX idx_video_jobs_user_status_created ON public.video_jobs USING btree (user_id, status, created_at DESC);

CREATE INDEX idx_video_jobs_workflow_id ON public.video_jobs USING btree (workflow_id);

CREATE UNIQUE INDEX image_jobs_comfy_job_id_key ON public.image_jobs USING btree (comfy_job_id);

CREATE UNIQUE INDEX image_jobs_pkey ON public.image_jobs USING btree (id);

CREATE UNIQUE INDEX project_folders_pkey ON public.project_folders USING btree (id);

CREATE UNIQUE INDEX project_folders_project_folder_id_key ON public.project_folders USING btree (project_folder_id);

CREATE UNIQUE INDEX text_jobs_comfy_job_id_key ON public.text_jobs USING btree (comfy_job_id);

CREATE UNIQUE INDEX text_jobs_pkey ON public.text_jobs USING btree (id);

CREATE UNIQUE INDEX upscale_batches_pkey ON public.upscale_batches USING btree (id);

CREATE UNIQUE INDEX upscale_videos_pkey ON public.upscale_videos USING btree (id);

CREATE UNIQUE INDEX video_jobs_comfy_job_id_key ON public.video_jobs USING btree (comfy_job_id);

CREATE UNIQUE INDEX video_jobs_pkey ON public.video_jobs USING btree (id);

CREATE UNIQUE INDEX workflows_name_key ON public.workflows USING btree (name);

CREATE UNIQUE INDEX workflows_pkey ON public.workflows USING btree (id);

alter table "public"."api_keys" add constraint "api_keys_pkey" PRIMARY KEY using index "api_keys_pkey";

alter table "public"."batch_job_items" add constraint "batch_job_items_pkey" PRIMARY KEY using index "batch_job_items_pkey";

alter table "public"."batch_jobs" add constraint "batch_jobs_pkey" PRIMARY KEY using index "batch_jobs_pkey";

alter table "public"."data" add constraint "data_pkey" PRIMARY KEY using index "data_pkey";

alter table "public"."datasets" add constraint "datasets_pkey" PRIMARY KEY using index "datasets_pkey";

alter table "public"."image_jobs" add constraint "image_jobs_pkey" PRIMARY KEY using index "image_jobs_pkey";

alter table "public"."project_folders" add constraint "project_folders_pkey" PRIMARY KEY using index "project_folders_pkey";

alter table "public"."text_jobs" add constraint "text_jobs_pkey" PRIMARY KEY using index "text_jobs_pkey";

alter table "public"."upscale_batches" add constraint "upscale_batches_pkey" PRIMARY KEY using index "upscale_batches_pkey";

alter table "public"."upscale_videos" add constraint "upscale_videos_pkey" PRIMARY KEY using index "upscale_videos_pkey";

alter table "public"."video_jobs" add constraint "video_jobs_pkey" PRIMARY KEY using index "video_jobs_pkey";

alter table "public"."workflows" add constraint "workflows_pkey" PRIMARY KEY using index "workflows_pkey";

alter table "public"."api_keys" add constraint "api_keys_key_hash_key" UNIQUE using index "api_keys_key_hash_key";

alter table "public"."api_keys" add constraint "api_keys_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE not valid;

alter table "public"."api_keys" validate constraint "api_keys_user_id_fkey";

alter table "public"."batch_job_items" add constraint "batch_job_items_batch_job_id_fkey" FOREIGN KEY (batch_job_id) REFERENCES public.batch_jobs(id) ON DELETE CASCADE not valid;

alter table "public"."batch_job_items" validate constraint "batch_job_items_batch_job_id_fkey";

alter table "public"."batch_job_items" add constraint "batch_job_items_image_job_id_fkey" FOREIGN KEY (image_job_id) REFERENCES public.image_jobs(id) ON DELETE SET NULL not valid;

alter table "public"."batch_job_items" validate constraint "batch_job_items_image_job_id_fkey";

alter table "public"."batch_job_items" add constraint "batch_job_items_item_type_check" CHECK ((item_type = ANY (ARRAY['master_frame'::text, 'scene_image'::text]))) not valid;

alter table "public"."batch_job_items" validate constraint "batch_job_items_item_type_check";

alter table "public"."batch_job_items" add constraint "batch_job_items_status_check" CHECK ((status = ANY (ARRAY['pending'::text, 'queued'::text, 'processing'::text, 'completed'::text, 'failed'::text]))) not valid;

alter table "public"."batch_job_items" validate constraint "batch_job_items_status_check";

alter table "public"."batch_jobs" add constraint "batch_jobs_status_check" CHECK ((status = ANY (ARRAY['pending'::text, 'validating'::text, 'analyzing'::text, 'generating_master'::text, 'completed'::text, 'failed'::text, 'cancelled'::text]))) not valid;

alter table "public"."batch_jobs" validate constraint "batch_jobs_status_check";

alter table "public"."batch_jobs" add constraint "batch_jobs_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE not valid;

alter table "public"."batch_jobs" validate constraint "batch_jobs_user_id_fkey";

alter table "public"."data" add constraint "data_dataset_id_fkey" FOREIGN KEY (dataset_id) REFERENCES public.datasets(id) ON DELETE CASCADE not valid;

alter table "public"."data" validate constraint "data_dataset_id_fkey";

alter table "public"."image_jobs" add constraint "image_jobs_batch_item_id_fkey" FOREIGN KEY (batch_item_id) REFERENCES public.batch_job_items(id) ON DELETE SET NULL not valid;

alter table "public"."image_jobs" validate constraint "image_jobs_batch_item_id_fkey";

alter table "public"."image_jobs" add constraint "image_jobs_batch_job_id_fkey" FOREIGN KEY (batch_job_id) REFERENCES public.batch_jobs(id) ON DELETE SET NULL not valid;

alter table "public"."image_jobs" validate constraint "image_jobs_batch_job_id_fkey";

alter table "public"."image_jobs" add constraint "image_jobs_comfy_job_id_key" UNIQUE using index "image_jobs_comfy_job_id_key";

alter table "public"."image_jobs" add constraint "image_jobs_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE not valid;

alter table "public"."image_jobs" validate constraint "image_jobs_user_id_fkey";

alter table "public"."image_jobs" add constraint "image_jobs_workflow_id_fkey" FOREIGN KEY (workflow_id) REFERENCES public.workflows(id) not valid;

alter table "public"."image_jobs" validate constraint "image_jobs_workflow_id_fkey";

alter table "public"."project_folders" add constraint "project_folders_project_folder_id_key" UNIQUE using index "project_folders_project_folder_id_key";

alter table "public"."project_folders" add constraint "project_folders_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE not valid;

alter table "public"."project_folders" validate constraint "project_folders_user_id_fkey";

alter table "public"."text_jobs" add constraint "text_jobs_comfy_job_id_key" UNIQUE using index "text_jobs_comfy_job_id_key";

alter table "public"."text_jobs" add constraint "text_jobs_status_check" CHECK ((status = ANY (ARRAY['pending'::text, 'processing'::text, 'completed'::text, 'failed'::text]))) not valid;

alter table "public"."text_jobs" validate constraint "text_jobs_status_check";

alter table "public"."text_jobs" add constraint "text_jobs_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE not valid;

alter table "public"."text_jobs" validate constraint "text_jobs_user_id_fkey";

alter table "public"."upscale_batches" add constraint "upscale_batches_status_check" CHECK ((status = ANY (ARRAY['pending'::text, 'processing'::text, 'completed'::text, 'failed'::text, 'paused'::text, 'cancelled'::text]))) not valid;

alter table "public"."upscale_batches" validate constraint "upscale_batches_status_check";

alter table "public"."upscale_batches" add constraint "upscale_batches_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) not valid;

alter table "public"."upscale_batches" validate constraint "upscale_batches_user_id_fkey";

alter table "public"."upscale_videos" add constraint "upscale_videos_batch_id_fkey" FOREIGN KEY (batch_id) REFERENCES public.upscale_batches(id) ON DELETE CASCADE not valid;

alter table "public"."upscale_videos" validate constraint "upscale_videos_batch_id_fkey";

alter table "public"."upscale_videos" add constraint "upscale_videos_drive_upload_status_check" CHECK ((drive_upload_status = ANY (ARRAY['pending'::text, 'completed'::text, 'failed'::text, 'skipped'::text]))) not valid;

alter table "public"."upscale_videos" validate constraint "upscale_videos_drive_upload_status_check";

alter table "public"."upscale_videos" add constraint "upscale_videos_status_check" CHECK ((status = ANY (ARRAY['pending'::text, 'processing'::text, 'completed'::text, 'failed'::text, 'paused'::text]))) not valid;

alter table "public"."upscale_videos" validate constraint "upscale_videos_status_check";

alter table "public"."upscale_videos" add constraint "upscale_videos_supabase_upload_status_check" CHECK ((supabase_upload_status = ANY (ARRAY['pending'::text, 'completed'::text, 'failed'::text, 'skipped'::text]))) not valid;

alter table "public"."upscale_videos" validate constraint "upscale_videos_supabase_upload_status_check";

alter table "public"."upscale_videos" add constraint "upscale_videos_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) not valid;

alter table "public"."upscale_videos" validate constraint "upscale_videos_user_id_fkey";

alter table "public"."video_jobs" add constraint "video_jobs_comfy_job_id_key" UNIQUE using index "video_jobs_comfy_job_id_key";

alter table "public"."video_jobs" add constraint "video_jobs_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE not valid;

alter table "public"."video_jobs" validate constraint "video_jobs_user_id_fkey";

alter table "public"."video_jobs" add constraint "video_jobs_workflow_id_fkey" FOREIGN KEY (workflow_id) REFERENCES public.workflows(id) not valid;

alter table "public"."video_jobs" validate constraint "video_jobs_workflow_id_fkey";

alter table "public"."workflows" add constraint "workflows_name_key" UNIQUE using index "workflows_name_key";

alter table "public"."workflows" add constraint "workflows_output_type_check" CHECK ((output_type = ANY (ARRAY['video'::text, 'image'::text, 'text'::text]))) not valid;

alter table "public"."workflows" validate constraint "workflows_output_type_check";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.get_random_user_id()
 RETURNS uuid
 LANGUAGE plpgsql
AS $function$
DECLARE
    random_user UUID;
BEGIN
    -- Get a random user_id from jobs that already have one
    SELECT user_id INTO random_user
    FROM (
        SELECT user_id FROM video_jobs WHERE user_id IS NOT NULL
        UNION
        SELECT user_id FROM image_jobs WHERE user_id IS NOT NULL
    ) AS users_with_jobs
    ORDER BY RANDOM()
    LIMIT 1;
    RETURN random_user;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.update_image_jobs_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.update_text_jobs_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.update_video_jobs_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$function$
;

grant delete on table "public"."api_keys" to "anon";

grant insert on table "public"."api_keys" to "anon";

grant references on table "public"."api_keys" to "anon";

grant select on table "public"."api_keys" to "anon";

grant trigger on table "public"."api_keys" to "anon";

grant truncate on table "public"."api_keys" to "anon";

grant update on table "public"."api_keys" to "anon";

grant delete on table "public"."api_keys" to "authenticated";

grant insert on table "public"."api_keys" to "authenticated";

grant references on table "public"."api_keys" to "authenticated";

grant select on table "public"."api_keys" to "authenticated";

grant trigger on table "public"."api_keys" to "authenticated";

grant truncate on table "public"."api_keys" to "authenticated";

grant update on table "public"."api_keys" to "authenticated";

grant delete on table "public"."api_keys" to "service_role";

grant insert on table "public"."api_keys" to "service_role";

grant references on table "public"."api_keys" to "service_role";

grant select on table "public"."api_keys" to "service_role";

grant trigger on table "public"."api_keys" to "service_role";

grant truncate on table "public"."api_keys" to "service_role";

grant update on table "public"."api_keys" to "service_role";

grant delete on table "public"."batch_job_items" to "anon";

grant insert on table "public"."batch_job_items" to "anon";

grant references on table "public"."batch_job_items" to "anon";

grant select on table "public"."batch_job_items" to "anon";

grant trigger on table "public"."batch_job_items" to "anon";

grant truncate on table "public"."batch_job_items" to "anon";

grant update on table "public"."batch_job_items" to "anon";

grant delete on table "public"."batch_job_items" to "authenticated";

grant insert on table "public"."batch_job_items" to "authenticated";

grant references on table "public"."batch_job_items" to "authenticated";

grant select on table "public"."batch_job_items" to "authenticated";

grant trigger on table "public"."batch_job_items" to "authenticated";

grant truncate on table "public"."batch_job_items" to "authenticated";

grant update on table "public"."batch_job_items" to "authenticated";

grant delete on table "public"."batch_job_items" to "service_role";

grant insert on table "public"."batch_job_items" to "service_role";

grant references on table "public"."batch_job_items" to "service_role";

grant select on table "public"."batch_job_items" to "service_role";

grant trigger on table "public"."batch_job_items" to "service_role";

grant truncate on table "public"."batch_job_items" to "service_role";

grant update on table "public"."batch_job_items" to "service_role";

grant delete on table "public"."batch_jobs" to "anon";

grant insert on table "public"."batch_jobs" to "anon";

grant references on table "public"."batch_jobs" to "anon";

grant select on table "public"."batch_jobs" to "anon";

grant trigger on table "public"."batch_jobs" to "anon";

grant truncate on table "public"."batch_jobs" to "anon";

grant update on table "public"."batch_jobs" to "anon";

grant delete on table "public"."batch_jobs" to "authenticated";

grant insert on table "public"."batch_jobs" to "authenticated";

grant references on table "public"."batch_jobs" to "authenticated";

grant select on table "public"."batch_jobs" to "authenticated";

grant trigger on table "public"."batch_jobs" to "authenticated";

grant truncate on table "public"."batch_jobs" to "authenticated";

grant update on table "public"."batch_jobs" to "authenticated";

grant delete on table "public"."batch_jobs" to "service_role";

grant insert on table "public"."batch_jobs" to "service_role";

grant references on table "public"."batch_jobs" to "service_role";

grant select on table "public"."batch_jobs" to "service_role";

grant trigger on table "public"."batch_jobs" to "service_role";

grant truncate on table "public"."batch_jobs" to "service_role";

grant update on table "public"."batch_jobs" to "service_role";

grant delete on table "public"."data" to "anon";

grant insert on table "public"."data" to "anon";

grant references on table "public"."data" to "anon";

grant select on table "public"."data" to "anon";

grant trigger on table "public"."data" to "anon";

grant truncate on table "public"."data" to "anon";

grant update on table "public"."data" to "anon";

grant delete on table "public"."data" to "authenticated";

grant insert on table "public"."data" to "authenticated";

grant references on table "public"."data" to "authenticated";

grant select on table "public"."data" to "authenticated";

grant trigger on table "public"."data" to "authenticated";

grant truncate on table "public"."data" to "authenticated";

grant update on table "public"."data" to "authenticated";

grant delete on table "public"."data" to "service_role";

grant insert on table "public"."data" to "service_role";

grant references on table "public"."data" to "service_role";

grant select on table "public"."data" to "service_role";

grant trigger on table "public"."data" to "service_role";

grant truncate on table "public"."data" to "service_role";

grant update on table "public"."data" to "service_role";

grant delete on table "public"."datasets" to "anon";

grant insert on table "public"."datasets" to "anon";

grant references on table "public"."datasets" to "anon";

grant select on table "public"."datasets" to "anon";

grant trigger on table "public"."datasets" to "anon";

grant truncate on table "public"."datasets" to "anon";

grant update on table "public"."datasets" to "anon";

grant delete on table "public"."datasets" to "authenticated";

grant insert on table "public"."datasets" to "authenticated";

grant references on table "public"."datasets" to "authenticated";

grant select on table "public"."datasets" to "authenticated";

grant trigger on table "public"."datasets" to "authenticated";

grant truncate on table "public"."datasets" to "authenticated";

grant update on table "public"."datasets" to "authenticated";

grant delete on table "public"."datasets" to "service_role";

grant insert on table "public"."datasets" to "service_role";

grant references on table "public"."datasets" to "service_role";

grant select on table "public"."datasets" to "service_role";

grant trigger on table "public"."datasets" to "service_role";

grant truncate on table "public"."datasets" to "service_role";

grant update on table "public"."datasets" to "service_role";

grant delete on table "public"."image_jobs" to "anon";

grant insert on table "public"."image_jobs" to "anon";

grant references on table "public"."image_jobs" to "anon";

grant select on table "public"."image_jobs" to "anon";

grant trigger on table "public"."image_jobs" to "anon";

grant truncate on table "public"."image_jobs" to "anon";

grant update on table "public"."image_jobs" to "anon";

grant delete on table "public"."image_jobs" to "authenticated";

grant insert on table "public"."image_jobs" to "authenticated";

grant references on table "public"."image_jobs" to "authenticated";

grant select on table "public"."image_jobs" to "authenticated";

grant trigger on table "public"."image_jobs" to "authenticated";

grant truncate on table "public"."image_jobs" to "authenticated";

grant update on table "public"."image_jobs" to "authenticated";

grant delete on table "public"."image_jobs" to "service_role";

grant insert on table "public"."image_jobs" to "service_role";

grant references on table "public"."image_jobs" to "service_role";

grant select on table "public"."image_jobs" to "service_role";

grant trigger on table "public"."image_jobs" to "service_role";

grant truncate on table "public"."image_jobs" to "service_role";

grant update on table "public"."image_jobs" to "service_role";

grant delete on table "public"."project_folders" to "anon";

grant insert on table "public"."project_folders" to "anon";

grant references on table "public"."project_folders" to "anon";

grant select on table "public"."project_folders" to "anon";

grant trigger on table "public"."project_folders" to "anon";

grant truncate on table "public"."project_folders" to "anon";

grant update on table "public"."project_folders" to "anon";

grant delete on table "public"."project_folders" to "authenticated";

grant insert on table "public"."project_folders" to "authenticated";

grant references on table "public"."project_folders" to "authenticated";

grant select on table "public"."project_folders" to "authenticated";

grant trigger on table "public"."project_folders" to "authenticated";

grant truncate on table "public"."project_folders" to "authenticated";

grant update on table "public"."project_folders" to "authenticated";

grant delete on table "public"."project_folders" to "service_role";

grant insert on table "public"."project_folders" to "service_role";

grant references on table "public"."project_folders" to "service_role";

grant select on table "public"."project_folders" to "service_role";

grant trigger on table "public"."project_folders" to "service_role";

grant truncate on table "public"."project_folders" to "service_role";

grant update on table "public"."project_folders" to "service_role";

grant delete on table "public"."text_jobs" to "anon";

grant insert on table "public"."text_jobs" to "anon";

grant references on table "public"."text_jobs" to "anon";

grant select on table "public"."text_jobs" to "anon";

grant trigger on table "public"."text_jobs" to "anon";

grant truncate on table "public"."text_jobs" to "anon";

grant update on table "public"."text_jobs" to "anon";

grant delete on table "public"."text_jobs" to "authenticated";

grant insert on table "public"."text_jobs" to "authenticated";

grant references on table "public"."text_jobs" to "authenticated";

grant select on table "public"."text_jobs" to "authenticated";

grant trigger on table "public"."text_jobs" to "authenticated";

grant truncate on table "public"."text_jobs" to "authenticated";

grant update on table "public"."text_jobs" to "authenticated";

grant delete on table "public"."text_jobs" to "service_role";

grant insert on table "public"."text_jobs" to "service_role";

grant references on table "public"."text_jobs" to "service_role";

grant select on table "public"."text_jobs" to "service_role";

grant trigger on table "public"."text_jobs" to "service_role";

grant truncate on table "public"."text_jobs" to "service_role";

grant update on table "public"."text_jobs" to "service_role";

grant delete on table "public"."upscale_batches" to "anon";

grant insert on table "public"."upscale_batches" to "anon";

grant references on table "public"."upscale_batches" to "anon";

grant select on table "public"."upscale_batches" to "anon";

grant trigger on table "public"."upscale_batches" to "anon";

grant truncate on table "public"."upscale_batches" to "anon";

grant update on table "public"."upscale_batches" to "anon";

grant delete on table "public"."upscale_batches" to "authenticated";

grant insert on table "public"."upscale_batches" to "authenticated";

grant references on table "public"."upscale_batches" to "authenticated";

grant select on table "public"."upscale_batches" to "authenticated";

grant trigger on table "public"."upscale_batches" to "authenticated";

grant truncate on table "public"."upscale_batches" to "authenticated";

grant update on table "public"."upscale_batches" to "authenticated";

grant delete on table "public"."upscale_batches" to "service_role";

grant insert on table "public"."upscale_batches" to "service_role";

grant references on table "public"."upscale_batches" to "service_role";

grant select on table "public"."upscale_batches" to "service_role";

grant trigger on table "public"."upscale_batches" to "service_role";

grant truncate on table "public"."upscale_batches" to "service_role";

grant update on table "public"."upscale_batches" to "service_role";

grant delete on table "public"."upscale_videos" to "anon";

grant insert on table "public"."upscale_videos" to "anon";

grant references on table "public"."upscale_videos" to "anon";

grant select on table "public"."upscale_videos" to "anon";

grant trigger on table "public"."upscale_videos" to "anon";

grant truncate on table "public"."upscale_videos" to "anon";

grant update on table "public"."upscale_videos" to "anon";

grant delete on table "public"."upscale_videos" to "authenticated";

grant insert on table "public"."upscale_videos" to "authenticated";

grant references on table "public"."upscale_videos" to "authenticated";

grant select on table "public"."upscale_videos" to "authenticated";

grant trigger on table "public"."upscale_videos" to "authenticated";

grant truncate on table "public"."upscale_videos" to "authenticated";

grant update on table "public"."upscale_videos" to "authenticated";

grant delete on table "public"."upscale_videos" to "service_role";

grant insert on table "public"."upscale_videos" to "service_role";

grant references on table "public"."upscale_videos" to "service_role";

grant select on table "public"."upscale_videos" to "service_role";

grant trigger on table "public"."upscale_videos" to "service_role";

grant truncate on table "public"."upscale_videos" to "service_role";

grant update on table "public"."upscale_videos" to "service_role";

grant delete on table "public"."video_jobs" to "anon";

grant insert on table "public"."video_jobs" to "anon";

grant references on table "public"."video_jobs" to "anon";

grant select on table "public"."video_jobs" to "anon";

grant trigger on table "public"."video_jobs" to "anon";

grant truncate on table "public"."video_jobs" to "anon";

grant update on table "public"."video_jobs" to "anon";

grant delete on table "public"."video_jobs" to "authenticated";

grant insert on table "public"."video_jobs" to "authenticated";

grant references on table "public"."video_jobs" to "authenticated";

grant select on table "public"."video_jobs" to "authenticated";

grant trigger on table "public"."video_jobs" to "authenticated";

grant truncate on table "public"."video_jobs" to "authenticated";

grant update on table "public"."video_jobs" to "authenticated";

grant delete on table "public"."video_jobs" to "service_role";

grant insert on table "public"."video_jobs" to "service_role";

grant references on table "public"."video_jobs" to "service_role";

grant select on table "public"."video_jobs" to "service_role";

grant trigger on table "public"."video_jobs" to "service_role";

grant truncate on table "public"."video_jobs" to "service_role";

grant update on table "public"."video_jobs" to "service_role";

grant delete on table "public"."workflows" to "anon";

grant insert on table "public"."workflows" to "anon";

grant references on table "public"."workflows" to "anon";

grant select on table "public"."workflows" to "anon";

grant trigger on table "public"."workflows" to "anon";

grant truncate on table "public"."workflows" to "anon";

grant update on table "public"."workflows" to "anon";

grant delete on table "public"."workflows" to "authenticated";

grant insert on table "public"."workflows" to "authenticated";

grant references on table "public"."workflows" to "authenticated";

grant select on table "public"."workflows" to "authenticated";

grant trigger on table "public"."workflows" to "authenticated";

grant truncate on table "public"."workflows" to "authenticated";

grant update on table "public"."workflows" to "authenticated";

grant delete on table "public"."workflows" to "service_role";

grant insert on table "public"."workflows" to "service_role";

grant references on table "public"."workflows" to "service_role";

grant select on table "public"."workflows" to "service_role";

grant trigger on table "public"."workflows" to "service_role";

grant truncate on table "public"."workflows" to "service_role";

grant update on table "public"."workflows" to "service_role";


  create policy "api_keys_service_all"
  on "public"."api_keys"
  as permissive
  for all
  to public
using (true)
with check (true);



  create policy "Allow all operations on data"
  on "public"."data"
  as permissive
  for all
  to public
using (true);



  create policy "Allow all operations on datasets"
  on "public"."datasets"
  as permissive
  for all
  to public
using (true);



  create policy "image_jobs_delete"
  on "public"."image_jobs"
  as permissive
  for delete
  to public
using ((auth.uid() = user_id));



  create policy "image_jobs_insert"
  on "public"."image_jobs"
  as permissive
  for insert
  to public
with check ((user_id IN ( SELECT users.id
   FROM auth.users)));



  create policy "image_jobs_select"
  on "public"."image_jobs"
  as permissive
  for select
  to public
using ((auth.uid() = user_id));



  create policy "image_jobs_update"
  on "public"."image_jobs"
  as permissive
  for update
  to public
using (true);



  create policy "Users can delete their own text jobs"
  on "public"."text_jobs"
  as permissive
  for delete
  to public
using ((auth.uid() = user_id));



  create policy "Users can insert their own text jobs"
  on "public"."text_jobs"
  as permissive
  for insert
  to public
with check (((auth.uid() = user_id) OR (user_id IS NULL)));



  create policy "Users can update their own text jobs"
  on "public"."text_jobs"
  as permissive
  for update
  to public
using (((auth.uid() = user_id) OR (user_id IS NULL)));



  create policy "Users can view their own text jobs"
  on "public"."text_jobs"
  as permissive
  for select
  to public
using (((auth.uid() = user_id) OR (user_id IS NULL)));



  create policy "video_jobs_delete"
  on "public"."video_jobs"
  as permissive
  for delete
  to public
using ((auth.uid() = user_id));



  create policy "video_jobs_insert"
  on "public"."video_jobs"
  as permissive
  for insert
  to public
with check ((user_id IN ( SELECT users.id
   FROM auth.users)));



  create policy "video_jobs_select"
  on "public"."video_jobs"
  as permissive
  for select
  to public
using ((auth.uid() = user_id));



  create policy "video_jobs_update"
  on "public"."video_jobs"
  as permissive
  for update
  to public
using (true);



  create policy "workflows_select"
  on "public"."workflows"
  as permissive
  for select
  to public
using (true);


CREATE TRIGGER update_datasets_updated_at BEFORE UPDATE ON public.datasets FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER text_jobs_updated_at_trigger BEFORE UPDATE ON public.text_jobs FOR EACH ROW EXECUTE FUNCTION public.update_text_jobs_updated_at();


  create policy "Allow all operations on images bucket"
  on "storage"."objects"
  as permissive
  for all
  to public
using ((bucket_id = 'images'::text));



  create policy "Allow public delete of multitalk videos"
  on "storage"."objects"
  as permissive
  for delete
  to public
using ((bucket_id = 'multitalk-videos'::text));



  create policy "Allow public read access to multitalk videos"
  on "storage"."objects"
  as permissive
  for select
  to public
using ((bucket_id = 'multitalk-videos'::text));



  create policy "Allow public update of multitalk videos"
  on "storage"."objects"
  as permissive
  for update
  to public
using ((bucket_id = 'multitalk-videos'::text));



  create policy "Allow public upload to multitalk videos"
  on "storage"."objects"
  as permissive
  for insert
  to public
with check ((bucket_id = 'multitalk-videos'::text));



  create policy "Allow uploads to edited-images 1wipfh8_0"
  on "storage"."objects"
  as permissive
  for select
  to anon, authenticated
using (true);



  create policy "Allow uploads to edited-images 1wipfh8_1"
  on "storage"."objects"
  as permissive
  for insert
  to anon, authenticated
with check (true);



  create policy "Allow uploads to edited-images 1wipfh8_2"
  on "storage"."objects"
  as permissive
  for update
  to anon, authenticated
using (true);



  create policy "Anyone can view avatars"
  on "storage"."objects"
  as permissive
  for select
  to public
using ((bucket_id = 'user-avatars'::text));



  create policy "Public access for edited-images"
  on "storage"."objects"
  as permissive
  for select
  to public
using ((bucket_id = 'edited-images'::text));



  create policy "Public uploads for edited-images"
  on "storage"."objects"
  as permissive
  for all
  to public
using ((bucket_id = 'edited-images'::text));



  create policy "Users can delete their own avatar"
  on "storage"."objects"
  as permissive
  for delete
  to authenticated
using (((bucket_id = 'user-avatars'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));



  create policy "Users can update their own avatar"
  on "storage"."objects"
  as permissive
  for update
  to authenticated
using (((bucket_id = 'user-avatars'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)))
with check (((bucket_id = 'user-avatars'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));



  create policy "Users can upload their own avatar"
  on "storage"."objects"
  as permissive
  for insert
  to authenticated
with check (((bucket_id = 'user-avatars'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));



