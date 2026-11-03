CREATE TABLE `api_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`key_prefix` text NOT NULL,
	`key_hash` text NOT NULL,
	`scopes` text NOT NULL,
	`created_at` text NOT NULL,
	`revoked_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_keys_key_hash_unique` ON `api_keys` (`key_hash`);
--> statement-breakpoint
CREATE TABLE `regions` (
	`id` text PRIMARY KEY NOT NULL,
	`parent_id` text,
	`level` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`geometry` text NOT NULL,
	`fill` text DEFAULT '#3d6b58' NOT NULL,
	`stroke` text DEFAULT '#f0e2c0' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`parent_id`) REFERENCES `regions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `regions_parent_idx` ON `regions` (`parent_id`);
--> statement-breakpoint
CREATE INDEX `regions_level_idx` ON `regions` (`level`);
--> statement-breakpoint
CREATE TABLE `places` (
	`id` text PRIMARY KEY NOT NULL,
	`region_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`kind` text DEFAULT 'landmark' NOT NULL,
	`x` real NOT NULL,
	`y` real NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`region_id`) REFERENCES `regions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `places_region_idx` ON `places` (`region_id`);
--> statement-breakpoint
CREATE TABLE `indoor_floors` (
	`id` text PRIMARY KEY NOT NULL,
	`region_id` text NOT NULL,
	`floor_index` integer NOT NULL,
	`name` text NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`region_id`) REFERENCES `regions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `floors_region_index_uq` ON `indoor_floors` (`region_id`,`floor_index`);
--> statement-breakpoint
CREATE INDEX `floors_region_idx` ON `indoor_floors` (`region_id`);
--> statement-breakpoint
CREATE TABLE `indoor_tiles` (
	`id` text PRIMARY KEY NOT NULL,
	`floor_id` text NOT NULL,
	`x` integer NOT NULL,
	`y` integer NOT NULL,
	`tile_type` text NOT NULL,
	`meta` text DEFAULT '{}' NOT NULL,
	FOREIGN KEY (`floor_id`) REFERENCES `indoor_floors`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tiles_floor_xy_uq` ON `indoor_tiles` (`floor_id`,`x`,`y`);
--> statement-breakpoint
CREATE INDEX `tiles_floor_idx` ON `indoor_tiles` (`floor_id`);
--> statement-breakpoint
CREATE TABLE `snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`reason` text NOT NULL,
	`actor_key_id` text,
	`payload` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `snapshots_created_idx` ON `snapshots` (`created_at`);
--> statement-breakpoint
CREATE TABLE `audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_key_id` text,
	`actor_name` text NOT NULL,
	`action` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text,
	`detail` text DEFAULT '{}' NOT NULL,
	`snapshot_id` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_created_idx` ON `audit_logs` (`created_at`);
