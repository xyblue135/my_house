package com.xyblue.myhouse.config;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

import javax.sql.DataSource;

import org.sqlite.SQLiteConfig;
import org.sqlite.SQLiteDataSource;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class DatabaseConfig {
    @Bean
    Path myhouseDataDir(@Value("${myhouse.data-dir:../data}") String configuredPath) throws IOException {
        Path path = Path.of(configuredPath).toAbsolutePath().normalize();
        Files.createDirectories(path);
        return path;
    }

    @Bean
    DataSource dataSource(Path myhouseDataDir) {
        Path dbPath = myhouseDataDir.resolve("inventory.db");
        SQLiteConfig config = new SQLiteConfig();
        config.enforceForeignKeys(true);
        config.setBusyTimeout(5000);
        // WAL 允许读写并发：多设备同时写时显著降低 SQLITE_BUSY（默认的 rollback journal 会整库加锁）。
        config.setJournalMode(SQLiteConfig.JournalMode.WAL);
        SQLiteDataSource dataSource = new SQLiteDataSource(config);
        dataSource.setUrl("jdbc:sqlite:" + dbPath);
        return dataSource;
    }
}
