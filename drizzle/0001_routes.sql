CREATE TABLE `routes` (
	`id` text PRIMARY KEY NOT NULL,
	`region_id` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`geometry` text NOT NULL,
	`width` integer,
	`style` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`region_id`) REFERENCES `regions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `routes_region_idx` ON `routes` (`region_id`);--> statement-breakpoint
CREATE INDEX `routes_kind_idx` ON `routes` (`kind`);