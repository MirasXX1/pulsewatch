package dev.pulsewatch;

import java.util.Map;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;

@RestControllerAdvice
class Errors {
    @ExceptionHandler(Store.Missing.class)
    ResponseEntity<?> missing() { return error(404, "Monitor not found."); }

    @ExceptionHandler(Monitor.Busy.class)
    ResponseEntity<?> busy(Monitor.Busy exception) { return error(409, exception.getMessage()); }

    @ExceptionHandler(IllegalArgumentException.class)
    ResponseEntity<?> invalid(IllegalArgumentException exception) { return error(400, exception.getMessage()); }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    ResponseEntity<?> validation() {
        return error(400, "A name (1–100 characters) and URL (up to 2048 characters) are required.");
    }

    @ExceptionHandler({HttpMessageNotReadableException.class, MethodArgumentTypeMismatchException.class})
    ResponseEntity<?> malformed() { return error(400, "Provide valid JSON and a numeric monitor ID."); }

    @ExceptionHandler(Exception.class)
    ResponseEntity<?> other(Exception exception) {
        org.slf4j.LoggerFactory.getLogger(Errors.class).error("API request failed", exception);
        return error(500, "Unable to complete the request. Check the backend logs.");
    }

    private ResponseEntity<?> error(int status, String message) {
        return ResponseEntity.status(status).body(Map.of("message", message == null ? "Invalid request." : message));
    }
}
