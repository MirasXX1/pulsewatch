package dev.pulsewatch;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import static org.junit.jupiter.api.Assertions.*;
class ProbeTest {
 @BeforeAll static void requireNetworkPermission()throws Exception{
  try(ServerSocket ignored=new ServerSocket(0,1,InetAddress.getLoopbackAddress())){}
  catch(SocketException e){
   if(e.getMessage().contains("Operation not permitted"))Assumptions.assumeTrue(false,"Sandbox prohibits binding loopback sockets");
   else throw e;
  }
 }
 // Only tests override DNS to reach a fixture on loopback. Production policy is never weakened.
 private UrlPolicy fixturePolicy(){return new UrlPolicy(){@Override public InetAddress[] resolve(URI uri)throws UnknownHostException{
  if(!uri.getHost().equals("fixture.example"))return super.resolve(uri);
  return new InetAddress[]{InetAddress.getLoopbackAddress()};
 }};}
 private Probe.Result response(String headers)throws Exception{
  try(ServerSocket server=new ServerSocket(0,1,InetAddress.getLoopbackAddress());ProbeFixture fixture=new ProbeFixture(server,headers);){
   Probe probe=new Probe(fixturePolicy());try{return probe.check("http://fixture.example:"+server.getLocalPort()+"/health?q=1");}finally{probe.close();}
  }
 }
 private static class ProbeFixture implements AutoCloseable{
  final ExecutorService thread=Executors.newSingleThreadExecutor();
  ProbeFixture(ServerSocket server,String response){thread.submit(()->{try(Socket socket=server.accept()){
   socket.setSoTimeout(2000);BufferedReader reader=new BufferedReader(new InputStreamReader(socket.getInputStream()));String line;while((line=reader.readLine())!=null&&!line.isEmpty()){}
   socket.getOutputStream().write(response.getBytes(StandardCharsets.ISO_8859_1));socket.getOutputStream().flush();
   // Declare an enormous body, then wait: the probe must return after headers, without reading it.
   socket.getInputStream().read();
  }catch(IOException ignored){}});}
  public void close(){thread.shutdownNow();}
 }
 @ParameterizedTest @ValueSource(ints={200,204,299,300,301,399}) void upStatuses(int code)throws Exception{assertEquals("UP",response("HTTP/1.1 "+code+" Test\r\nContent-Length: 999999999\r\n\r\n").status());}
 @ParameterizedTest @ValueSource(ints={101,400,404,429,500,503}) void downStatuses(int code)throws Exception{Probe.Result r=response("HTTP/1.1 "+code+" Test\r\n\r\n");assertEquals("DOWN",r.status());assertEquals(code,r.httpCode());}
 @Test void blocksRedirectToPrivateAddress()throws Exception{Probe.Result r=response("HTTP/1.1 302 Found\r\nLocation: http://127.0.0.1/secret\r\n\r\n");assertEquals("DOWN",r.status());assertNotNull(r.error());}
 @Test void blocksRedirectDnsToPrivateAddress()throws Exception{Probe.Result r=response("HTTP/1.1 302 Found\r\nLocation: http://localhost/secret\r\n\r\n");assertEquals("DOWN",r.status());}
 @Test void followsRelativeRedirectAndLimitsLoops()throws Exception{
  try(ServerSocket server=new ServerSocket(0,10,InetAddress.getLoopbackAddress())){
   ExecutorService worker=Executors.newSingleThreadExecutor();worker.submit(()->{for(int i=0;i<6;i++)try(Socket s=server.accept()){s.getOutputStream().write("HTTP/1.1 302 Found\r\nLocation: /again\r\n\r\n".getBytes());}catch(IOException ignored){break;}});
   Probe probe=new Probe(fixturePolicy());try{Probe.Result result=probe.check("http://fixture.example:"+server.getLocalPort());assertEquals("DOWN",result.status());assertEquals("Too many redirects",result.error());}finally{probe.close();worker.shutdownNow();}
  }
 }
 @Test void handlesInterimResponse()throws Exception{assertEquals("UP",response("HTTP/1.1 103 Early Hints\r\n\r\nHTTP/1.1 200 OK\r\n\r\n").status());}
 @Test void rejectsOversizedHeaders()throws Exception{assertEquals("DOWN",response("HTTP/1.1 200 OK\r\nX-Huge: "+"x".repeat(33000)+"\r\n\r\n").status());}
 @Test void recordsConnectionFailure(){try(ServerSocket server=new ServerSocket(0)){int port=server.getLocalPort();server.close();Probe probe=new Probe(fixturePolicy());try{Probe.Result r=probe.check("http://fixture.example:"+port);assertEquals("DOWN",r.status());assertNull(r.httpCode());assertNotNull(r.error());assertTrue(r.durationMs()>=0);}finally{probe.close();}}catch(IOException e){fail(e);}}
 @Test void enforcesDeadlineOnStalledResponse()throws Exception{
  try(ServerSocket server=new ServerSocket(0,1,InetAddress.getLoopbackAddress())){
   ExecutorService worker=Executors.newSingleThreadExecutor();worker.submit(()->{try(Socket s=server.accept()){s.setSoTimeout(20000);s.getInputStream().readAllBytes();}catch(IOException ignored){}});
   Probe probe=new Probe(fixturePolicy());try{long start=System.nanoTime();Probe.Result r=probe.check("http://fixture.example:"+server.getLocalPort());assertEquals("DOWN",r.status());assertTrue(TimeUnit.NANOSECONDS.toSeconds(System.nanoTime()-start)<18);}finally{probe.close();worker.shutdownNow();}
  }
 }
}
