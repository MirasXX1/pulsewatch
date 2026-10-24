package dev.pulsewatch;
import java.time.Instant;
import java.util.List;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
class MonitorTest {
 static class MemoryStore extends Store{
  final CountDownLatch saved=new CountDownLatch(1);volatile Probe.Result result;
  MemoryStore(){super(null);}
  @Override public Site get(long id){return new Site(id,"Example","https://example.com",Instant.now(),"PENDING",0,0,null,null,false);}
  @Override public List<Site> all(){return List.of(get(1));}
  @Override public void save(long id,Probe.Result r){result=r;saved.countDown();}
 }
 @Test void excludesOverlappingChecksAndSavesResult()throws Exception{
  MemoryStore store=new MemoryStore();CountDownLatch started=new CountDownLatch(1),release=new CountDownLatch(1);
  Probe probe=new Probe(new UrlPolicy()){@Override public Result check(String url){started.countDown();try{release.await(3,TimeUnit.SECONDS);}catch(InterruptedException e){Thread.currentThread().interrupt();}return new Result(Instant.now(),"DOWN",503,42,null);}};
  Monitor monitor=new Monitor(store,probe);
  try{monitor.submit(1);assertTrue(started.await(2,TimeUnit.SECONDS));assertTrue(monitor.active(1));assertThrows(Monitor.Busy.class,()->monitor.submit(1));release.countDown();assertTrue(store.saved.await(2,TimeUnit.SECONDS));assertEquals("DOWN",store.result.status());assertEquals(503,store.result.httpCode());}finally{release.countDown();monitor.close();probe.close();}
 }
 @Test void boundsWorkerConcurrencyAndQueue()throws Exception{
  MemoryStore store=new MemoryStore();AtomicInteger running=new AtomicInteger(),maximum=new AtomicInteger();CountDownLatch started=new CountDownLatch(4),release=new CountDownLatch(1);
  Probe probe=new Probe(new UrlPolicy()){@Override public Result check(String url){int count=running.incrementAndGet();maximum.accumulateAndGet(count,Math::max);started.countDown();try{release.await(5,TimeUnit.SECONDS);}catch(InterruptedException e){Thread.currentThread().interrupt();}finally{running.decrementAndGet();}return new Result(Instant.now(),"UP",200,1,null);}};
  Monitor monitor=new Monitor(store,probe);
  try{for(int i=1;i<=104;i++)monitor.submit(i);assertTrue(started.await(2,TimeUnit.SECONDS));assertThrows(Monitor.Busy.class,()->monitor.submit(105));assertFalse(monitor.active(105));assertEquals(4,maximum.get());}finally{release.countDown();monitor.close();probe.close();}
 }
 @Test void classifiesEveryHttpStatus(){for(int code=100;code<=599;code++)assertEquals(code>=200&&code<=399,Probe.isUp(code),"HTTP "+code);}
 @Test void scheduledTickQueuesRealCheck()throws Exception{
  MemoryStore store=new MemoryStore();Probe probe=new Probe(new UrlPolicy()){@Override public Result check(String url){return new Result(Instant.now(),"UP",204,5,null);}};Monitor monitor=new Monitor(store,probe);
  try{monitor.tick();assertTrue(store.saved.await(2,TimeUnit.SECONDS));assertEquals("UP",store.result.status());}finally{monitor.close();probe.close();}
 }
}
