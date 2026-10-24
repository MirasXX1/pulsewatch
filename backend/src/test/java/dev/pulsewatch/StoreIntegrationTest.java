package dev.pulsewatch;
import java.nio.charset.StandardCharsets;
import java.sql.*;
import java.time.Instant;
import java.util.Objects;
import java.util.UUID;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import static org.junit.jupiter.api.Assertions.*;
@EnabledIfEnvironmentVariable(named="PULSEWATCH_TEST_DB_URL",matches=".+")
class StoreIntegrationTest {
 private static String schema;private static DriverManagerDataSource admin;private Store store;
 @BeforeAll static void database()throws Exception{
  admin=new DriverManagerDataSource(System.getenv("PULSEWATCH_TEST_DB_URL"),System.getenv().getOrDefault("PULSEWATCH_TEST_DB_USER","pulsewatch"),System.getenv().getOrDefault("PULSEWATCH_TEST_DB_PASSWORD","local-development-only"));
  schema="pulsewatch_test_"+UUID.randomUUID().toString().replace("-","");new JdbcTemplate(admin).execute("CREATE SCHEMA "+schema);
 }
 @BeforeEach void init()throws Exception{
  DriverManagerDataSource source=new DriverManagerDataSource(admin.getUrl()+(admin.getUrl().contains("?")?"&":"?")+"currentSchema="+schema,admin.getUsername(),admin.getPassword());
  JdbcTemplate db=new JdbcTemplate(source);db.execute("DROP TABLE IF EXISTS checks");db.execute("DROP TABLE IF EXISTS sites");
  String migration=new String(Objects.requireNonNull(getClass().getResourceAsStream("/db/migration/V1__initial.sql")).readAllBytes(),StandardCharsets.UTF_8);
  for(String sql:migration.split(";"))if(!sql.isBlank())db.execute(sql);store=new Store(db);
 }
 @AfterAll static void cleanup(){if(admin!=null&&schema!=null)new JdbcTemplate(admin).execute("DROP SCHEMA "+schema+" CASCADE");}
 @Test void persistsHistoryComputesShareAndCascadesDelete(){
  long id=store.add("Example","https://example.com");assertEquals("PENDING",store.get(id).status());assertNull(store.get(id).successRate());
  store.save(id,new Probe.Result(Instant.now().minusSeconds(10),"UP",200,81,null));
  store.save(id,new Probe.Result(Instant.now(),"DOWN",null,15000,"Timeout"));
  Store.Site site=store.get(id);assertEquals(2,site.totalChecks());assertEquals(1,site.successfulChecks());assertEquals(50.0,site.successRate());assertEquals("DOWN",site.status());assertEquals("Timeout",site.latest().error());assertEquals(15000,site.latest().durationMs());assertNull(site.latest().httpCode());assertEquals(2,store.history(id,100).size());
  store.delete(id);assertTrue(store.history(id,100).isEmpty());assertThrows(Store.Missing.class,()->store.get(id));
  store.save(id,new Probe.Result(Instant.now(),"UP",200,1,null));assertTrue(store.history(id,100).isEmpty());
 }
 @Test void isolatesSitesAndReturnsNewestHundred(){long first=store.add("One","https://example.com"),second=store.add("Two","https://example.org");for(int i=0;i<105;i++)store.save(first,new Probe.Result(Instant.EPOCH.plusSeconds(i),"UP",200,i,null));assertEquals(100,store.history(first,100).size());assertEquals(104,store.history(first,100).getFirst().durationMs());assertEquals(0,store.get(second).totalChecks());assertEquals(100.0,store.get(first).successRate());}
}
